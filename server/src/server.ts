import {
    createConnection,
    TextDocuments,
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
    Hover,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { get_robsons_path, lowerAlias, removeComments, remove_file_prefix } from "./utils";
import { validateTextDocument } from './validations';
import { ConnectionOptions } from 'vscode-languageclient';
import * as fs from "node:fs/promises";
import * as path from "path"
interface DefaultSettings {
    maxNumberOfProblems: number;
}

export type AliasInfo = {
    range: Range,
    value: string
}

const defaultSettings: DefaultSettings = { maxNumberOfProblems: 1000 };

export let connection = createConnection(ProposedFeatures.all);
export let hasDiagnosticRelatedInformationCapability: boolean = false;

let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
let aliases: AliasInfo[] = [];
let aliasUse: AliasInfo[] = [];
let globalSettings: DefaultSettings = defaultSettings;

let documentSettings: Map<string, Thenable<DefaultSettings>> = new Map();
let hasConfigurationCapability: boolean = false;

export function setAliases(newAliases: AliasInfo[]) {
    aliases = newAliases;
}
export function setAliasUse(newUses: AliasInfo[]) {
    aliasUse = newUses;
}

connection.onInitialize((params: InitializeParams) => {
    let capabilities = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
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
    return result;
});

connection.onInitialized((t) => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
});


export function getDocumentSettings(resource: string): Thenable<DefaultSettings> {
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



connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = <DefaultSettings>(
            (change.settings.languageServerExample || defaultSettings)
        );
    }

    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

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
// connection.workspace.onDidChangeWorkspaceFolders((param) => {
//     // connection.console.log(param.added);

//     for (const a of param.added) {
//         connection.console.log(a.name);
//     }

// })
// This handler provides the initial list of the completion items.

connection.onCompletion(
    async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
        // The pass parameter contains the position of the text document in
        // which code complete got requested. For the example we ignore this
        // info and always provide the same completion items.
        // connection.console.log(textDocumentPosition.position.line)

        const textDocument = documents.get(textDocumentPosition.textDocument.uri);

        const raw_text = textDocument?.getText({
            start: {
                character: 0,
                line: textDocumentPosition.position.line
            },
            end: {
                character: 0,
                line: textDocumentPosition.position.line + 1
            }
        })
        const paths = [];
        if (raw_text) {
            const text = removeComments(raw_text);
            if (text.includes("robsons")) {
                const robsons_path = get_robsons_path(text);
                connection.console.log(`robson -> ${robsons_path}`);
                const folderConnection = await connection.workspace.getWorkspaceFolders();

                if (folderConnection) {
                    for (const folder of folderConnection) {
                        let root_path = remove_file_prefix(folder.uri);

                        robsons_path.forEach((x, i) => {
                            if (robsons_path.length - 1 !== i) {
                                root_path = path.join(root_path, x.trim());
                            }
                        });
                        try {
                            connection.console.log(`${robsons_path},, ${root_path}`);
                            const j = await fs.readdir(root_path);
                            for (const s of j) {
                                const info = await fs.lstat(path.join(root_path, s));
                                if (info.isFile()) {
                                    paths.push(s);
                                }
                                if (info.isDirectory()) {
                                    paths.push(`${s}\\`);
                                }
                                // connection.console.log(s);
                            }
                        } catch { }
                    }
                }
            }
        }
        const pathsCompletion: CompletionItem[] = paths.map(path => {
            return {
                label: path,
                kind: CompletionItemKind.File
            }
        })

        const aliasesCompletetion: CompletionItem[] = aliases.map(alias => {
            return {
                label: alias.value,
                kind: CompletionItemKind.Function
            }
        });
        if (pathsCompletion.length > 0) {
            return pathsCompletion
        }
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
            ...aliasesCompletetion,
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

// connection.onHover(params => {
//     // params.position.line
//     // params.position.character
//     const textDocument = documents.get(params.textDocument.uri);
//     const text = textDocument?.getText();
//     if (text) {
//         const split = text.split("\n");
//         connection.console.log(split[params.position.line]);

//         // const a: Hover = {
//         //     contents: "Teste",
//         //     // range: {
//         //     //     start: {
//         //     //         line: params.position.line,
//         //     //         character: 0
//         //     //     },
//         //     //     end: {
//         //     //         line: params.pos
//         //     //     }
//         //     // }
//         // }
//     }

//     return null;
// })

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();