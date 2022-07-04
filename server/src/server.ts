import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    CodeAction,
    CodeActionKind,
    Command,
    TextDocumentEdit,
    TextEdit,
    Location,
    Range,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { lowerAlias } from "./utils";


type AliasInfo = {
    range: Range,
    value: string
}

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let aliases: AliasInfo[] = [];
let aliasUse: AliasInfo[] = []
let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
    let capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true,
            },
            // Tell the client that this server support code actions.
            codeActionProvider: true,
            // Tell the client that this server support commnds
            executeCommandProvider: {
                commands: ["re.name"]
            },
            // Tell the client thtat this server support definitions
            definitionProvider: true,
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized((t) => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

// The example settings
interface ExampleSettings {
    maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = <ExampleSettings>(
            (change.settings.languageServerExample || defaultSettings)
        );
    }

    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'RobsonAnalyzer'
        });
        documentSettings.set(resource, result);
    }
    return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
    // const inlay = new InlayHint(e.document.positionAt(0), "teste", InlayHintKind.Type);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});
async function updateAliases(textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const aliasDeclarationPattern = /\w+\b:/g;
    const values: AliasInfo[] = [];
    let aliasDeclarationMatch: RegExpExecArray | null;
    const text = textDocument.getText();
    while (aliasDeclarationMatch = aliasDeclarationPattern.exec(text)) {
        const range = {
            start: textDocument.positionAt(aliasDeclarationMatch.index),
            end: textDocument.positionAt(aliasDeclarationMatch.index + aliasDeclarationMatch[0].length)
        };
        const stringMatch = aliasDeclarationMatch?.toString().replace(":", "");
        const alias = values.find(a => a.value === stringMatch);
        if (alias) {
            let diagnostic: Diagnostic = {
                message: `Duplicated alias ${aliasDeclarationMatch.toString()}`,
                range,
                severity: DiagnosticSeverity.Error
            }
            if (hasDiagnosticRelatedInformationCapability) {
                diagnostic.relatedInformation = [
                    {
                        location: {
                            uri: textDocument.uri,
                            range: Object.assign({}, alias.range)
                        },
                        message: "First declared here"
                    },
                ];
            }
            diagnostics.push(diagnostic);
        } else {
            values.push({ range, value: stringMatch });
        }
    }
    aliases = values;

    const aliasUsagePattern = /\w*:\b\w+/g
    let aliasUsageMatch: RegExpExecArray | null;
    let aliasUsages: AliasInfo[] = [];
    while (aliasUsageMatch = aliasUsagePattern.exec(text)) {
        let stringMatch = aliasUsageMatch?.toString().replace(":", "");
        const declaration = values.find(a => a.value == stringMatch);
        const range: Range = {
            start: textDocument.positionAt(aliasUsageMatch.index),
            end: textDocument.positionAt(aliasUsageMatch.index + aliasUsageMatch[0].length)
        };

        if (!declaration) {
            let diagnostic: Diagnostic = {
                message: "Using alias before declaration",
                range,
                severity: DiagnosticSeverity.Error
            }
            diagnostics.push(diagnostic);
        }
        aliasUsages.push({ value: stringMatch, range });
    }
    aliasUse = aliasUsages;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // In this simple example we get the settings for every validate run.
    let settings = await getDocumentSettings(textDocument.uri);
    // The validator creates diagnostics for all uppercase words length 2 and more
    let text = textDocument.getText();
    let problems = 0;
    let diagnostics: Diagnostic[] = [];

    let camelCasePattern = /:[A-Za-z]([A-Z0-9]*[a-z][a-z0-9]*[A-Z]|[a-z0-9]*[A-Z][A-Z0-9]*[a-z])[A-Za-z0-9]*|[A-Za-z]([A-Z0-9]*[a-z][a-z0-9]*[A-Z]|[a-z0-9]*[A-Z][A-Z0-9]*[a-z])[A-Za-z0-9]*:/g;
    let camelCaseMatch: RegExpExecArray | null;
    while ((camelCaseMatch = camelCasePattern.exec(text)) && problems < settings.maxNumberOfProblems) {
        problems++;
        let diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: {
                start: textDocument.positionAt(camelCaseMatch.index),
                end: textDocument.positionAt(camelCaseMatch.index + camelCaseMatch[0].length)
            },
            message: `${camelCaseMatch[0]} Has camel case`,
            source: 'ex',
        };

        const lowercase = lowerAlias(camelCaseMatch[0]);

        if (hasDiagnosticRelatedInformationCapability) {
            diagnostic.relatedInformation = [
                {
                    location: {
                        uri: textDocument.uri,
                        range: Object.assign({}, diagnostic.range)
                    },
                    message: `Write it as ${lowercase}`
                },
            ];
        }
        diagnostics.push(diagnostic);
    }

    let invalidLambeuPattern = /\blambeu [^:].*\b/g;
    let invalidLambeuMatch: RegExpExecArray | null;
    while ((invalidLambeuMatch = invalidLambeuPattern.exec(text)) && problems < settings.maxNumberOfProblems) {
        problems++;
        let diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            message: "Invalid alias for lambeu",
            range: {
                start: textDocument.positionAt(invalidLambeuMatch.index),
                end: textDocument.positionAt(invalidLambeuMatch.index + invalidLambeuMatch[0].length)
            }
        }
        diagnostics.push(diagnostic);
    }
    updateAliases(textDocument, diagnostics);

    // Send the computed diagnostics to VS Code.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VS Code
    connection.console.log('We received a file change event');
});

connection.onDefinition(params => {
    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) {
        return
    }

    let aliasSelected: AliasInfo | undefined;

    for (const alias of aliasUse) {
        const line = alias.range.start.line;
        const char_start = alias.range.start.character;
        const char_end = alias.range.end.character;
        if (line === params.position.line && params.position.character >= char_start && params.position.character <= char_end) {
            aliasSelected = alias;
        }
    }

    if (!aliasSelected) {
        return
    }
    const aliasDeclaration = aliases.find(a => a.value === aliasSelected?.value);
    if (!aliasDeclaration) {
        return
    }

    return Location.create(params.textDocument.uri, aliasDeclaration.range);
})

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        // The pass parameter contains the position of the text document in
        // which code complete got requested. For the example we ignore this
        // info and always provide the same completion items.

        const aliasesCompletetion: CompletionItem[] = aliases.map(alias => {
            return {
                label: alias.value,
                kind: CompletionItemKind.Function
            }
        });

        return [
            {
                label: 'comeu',
                kind: CompletionItemKind.TypeParameter,
                data: "b1"
            },
            {
                label: 'fudeu',
                kind: CompletionItemKind.TypeParameter,
                data: "b2"
            },
            {
                label: 'penetrou',
                kind: CompletionItemKind.TypeParameter,
                data: "b3"
            },
            {
                label: 'chupou',
                kind: CompletionItemKind.TypeParameter,
                data: "b4"
            },
            {
                label: 'lambeu',
                kind: CompletionItemKind.TypeParameter,
                data: "b5"
            },
            {
                label: 'robson',
                kind: CompletionItemKind.Keyword,
                data: "b6",
            },
            ...aliasesCompletetion
        ];
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        const datas: any = {
            "b1": () => {
                item.detail = 'comeu';
                item.documentation = 'returns the raw number';
            },
            "b2": () => {
                item.detail = 'fudeu';
                item.documentation = 'return the value from the given address';
            },
            "b3": () => {
                item.detail = 'penetrou';
                item.documentation = 'return the value of the adress that the given address points to';
            },
            "b4": () => {
                item.detail = 'chupou';
                item.documentation = 'return the value inside of the by the given amount'
            },
            "b5": () => {
                item.detail = "lambeu";
                item.documentation = "return the line of the alias";
            }
        }
        if (item.data) {
            if (datas[item.data] != undefined) {
                datas[item.data]();
            }
        }
        return item;
    }
);


connection.onCodeAction(params => {
    const textDocument = documents.get(params.textDocument.uri);
    if (textDocument == undefined) {
        return undefined
    }
    const [diagnostic] = params.context.diagnostics;
    if (!diagnostic) {
        return []
    }
    const fixes = [];
    if (diagnostic.message.includes("camel case")) {
        const title = "Rename";
        fixes.push(CodeAction.create(title, Command.create(title, 're.name', textDocument.uri, params.range), CodeActionKind.QuickFix))
    }
    return fixes
})

connection.onExecuteCommand(params => {
    switch (params.command) {
        case 're.name': {
            if (params.arguments === undefined) {
                return
            }
            const [document, range] = params.arguments;
            if (!document || !range) {
                return
            }
            const textDocument = documents.get(document);
            if (textDocument === undefined) {
                return;
            }

            const text = textDocument.getText(range);

            const lowered_alias = lowerAlias(text);

            console.log({ lowered_alias });

            connection.workspace.applyEdit({
                documentChanges: [
                    TextDocumentEdit.create({ uri: textDocument.uri, version: textDocument.version }, [
                        TextEdit.replace(params.arguments[1], lowered_alias)
                    ])
                ]
            });




            break;
        }

        default: {
            break;
        }
    }


})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();