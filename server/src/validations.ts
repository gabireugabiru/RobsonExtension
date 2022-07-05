import { setAliasUse, setAliases, AliasInfo, hasDiagnosticRelatedInformationCapability, connection, getDocumentSettings } from "./server";
import {
    Diagnostic,
    DiagnosticSeverity,
    Range,
} from 'vscode-languageserver/node';
import { getOpcode, labels, lowerAlias, parameterCount, removeComments } from "./utils";
import { TextDocument } from 'vscode-languageserver-textdocument';

type Problems = {
    max: number,
    current: number
}

export async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    let settings = await getDocumentSettings(textDocument.uri);
    let problems: Problems = { current: 0, max: settings.maxNumberOfProblems };
    let diagnostics: Diagnostic[] = [];

    // Do the validations
    validateCamelCase(textDocument, problems, diagnostics);
    validateParams(textDocument, problems, diagnostics);
    updateAliases(textDocument, problems, diagnostics);
    validateCommands(textDocument, problems, diagnostics);
    invalidKeywords(textDocument, problems, diagnostics);

    // Send the diagnotics;
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

async function validateCommands(textDocument: TextDocument, problems: Problems, diagnostics: Diagnostic[]) {
    const commandPattern = /^ *?robson *.*/gm;
    let match: RegExpExecArray | null;
    const text = textDocument.getText();

    while ((match = commandPattern.exec(text)) && problems.current < problems.max) {
        const stringMatch = match.toString();
        const opcode = getOpcode(stringMatch);
        if (opcode < 0 || opcode > 12) {
            continue
        }
        const start = textDocument.positionAt(match.index);
        const paramsCount = (parameterCount as any)[opcode];
        let given = 0;
        for (let i = 0; i < paramsCount; i++) {
            const range: Range = {
                start: {
                    character: 0,
                    line: start.line + i + 1
                },
                end: {
                    character: 0,
                    line: start.line + i + 2
                }
            }
            const param = removeComments(textDocument.getText(range).trim());
            if (param.length === 0) {
                let diagnostic: Diagnostic = {
                    message: `Missing parameters for ${(labels as any)[opcode]}, needs ${paramsCount} given ${given}`,
                    range,
                    severity: DiagnosticSeverity.Error
                }
                diagnostics.push(diagnostic);
                problems.current++;
                break;
            } else {

            }
            given++
        }
    }
}
async function validateCamelCase(textDocument: TextDocument, problems: Problems, diagnostics: Diagnostic[]) {
    let camelCasePattern = /:[A-Za-z]([A-Z0-9]*[a-z][a-z0-9]*[A-Z]|[a-z0-9]*[A-Z][A-Z0-9]*[a-z])[A-Za-z0-9]*|[A-Za-z]([A-Z0-9]*[a-z][a-z0-9]*[A-Z]|[a-z0-9]*[A-Z][A-Z0-9]*[a-z])[A-Za-z0-9]*:/g;
    let camelCaseMatch: RegExpExecArray | null;
    const text = textDocument.getText();
    while ((camelCaseMatch = camelCasePattern.exec(text)) && problems.current < problems.max) {
        problems.current++;
        let diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Warning,
            range: rangeFromMatch(camelCaseMatch, textDocument),
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
}

async function invalidKeywords(textDocument: TextDocument, problems: Problems, diagnostics: Diagnostic[]) {
    const pattern = /^(?! *(robson|comeu|fudeu|penetrou|chupou|lambeu|;|\w+:|\n)).*/gm;
    let match: RegExpExecArray | null;
    const text = textDocument.getText();
    while ((match = pattern.exec(text)) && problems.current < problems.max) {
        if (match[0].trim().length == 0) {
            break
        }
        let diagnostic: Diagnostic = {
            message: `Unknown keyword ${match.toString()}`,
            range: rangeFromMatch(match, textDocument),
            severity: DiagnosticSeverity.Error
        }
        diagnostics.push(diagnostic);
        problems.current++;
    }
}
function validateParams(textDocument: TextDocument, problems: Problems, diagnostics: Diagnostic[]) {
    const invalidLambeuPattern = /\b *lambeu [^:].*\b/g;
    let invalidLambeuMatch: RegExpExecArray | null;
    const text = textDocument.getText();
    while ((invalidLambeuMatch = invalidLambeuPattern.exec(text)) && problems.current < problems.max) {
        let diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            message: "Invalid alias for lambeu",
            range: rangeFromMatch(invalidLambeuMatch, textDocument)
        }
        diagnostics.push(diagnostic);
        problems.current++;
    }
    const invalidComeuPattern = / *comeu (?!([0-9]|f[0-9]|i-?[0-9])).*/g;
    let invalidComeuMatch: RegExpExecArray | null;
    while ((invalidComeuMatch = invalidComeuPattern.exec(text)) && problems.current < problems.max) {
        let diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            message: "Invalid number for comeu",
            range: rangeFromMatch(invalidComeuMatch, textDocument)
        }
        problems.current++;
        diagnostics.push(diagnostic);
    }
    const invalidU32Pattern = / *(fudeu|penetrou|chupou) (?![0-9]).*/g
    let invalidU32Match: RegExpExecArray | null;

    while ((invalidU32Match = invalidU32Pattern.exec(text)) && problems.current < problems.max) {
        let name = "";
        const stringMatch = invalidU32Match.toString();

        if (stringMatch.includes("fudeu")) {
            name = "fudeu";
        } else if (stringMatch.includes("penetrou")) {
            name = "penetrou";
        } else {
            name = "chupou"
        }

        let diagnostic: Diagnostic = {
            message: `Invalid number for ${name}`,
            range: rangeFromMatch(invalidU32Match, textDocument),
            severity: DiagnosticSeverity.Error
        }
        problems.current++;
        diagnostics.push(diagnostic);
    }

}


async function updateAliases(textDocument: TextDocument, problems: Problems, diagnostics: Diagnostic[]) {
    const aliasDeclarationPattern = /\w+\b:/g;
    const values: AliasInfo[] = [];
    let aliasDeclarationMatch: RegExpExecArray | null;
    const text = textDocument.getText();
    while ((aliasDeclarationMatch = aliasDeclarationPattern.exec(text)) && problems.current < problems.max) {
        const range = rangeFromMatch(aliasDeclarationMatch, textDocument);
        const stringMatch = aliasDeclarationMatch?.toString().replace(":", "");

        const line = removeComments(textDocument.getText({
            start: {
                character: 0,
                line: range.start.line
            },
            end: range.end
        }));
        if (!line.includes(aliasDeclarationMatch[0])) {
            continue
        }

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
            problems.current++;
        } else {
            values.push({ range, value: stringMatch });
        }
    }
    setAliases(values);

    const aliasUsagePattern = /\w*:\b\w+/g
    let aliasUsageMatch: RegExpExecArray | null;
    let aliasUsages: AliasInfo[] = [];
    while (aliasUsageMatch = aliasUsagePattern.exec(text)) {
        let stringMatch = aliasUsageMatch?.toString().replace(":", "");
        const declaration = values.find(a => a.value == stringMatch);
        const range: Range = rangeFromMatch(aliasUsageMatch, textDocument);
        const line = removeComments(textDocument.getText({
            start: {
                character: 0,
                line: range.start.line
            },
            end: range.end
        }));
        if (!line.includes(aliasUsageMatch[0])) {
            continue
        }
        if (!declaration) {
            let diagnostic: Diagnostic = {
                message: "Using alias before declaration",
                range,
                severity: DiagnosticSeverity.Error
            }
            diagnostics.push(diagnostic);
            problems.current++;
        }
        aliasUsages.push({ value: stringMatch, range });
    }

    for (const aliasDeclaration of values) {
        const finded = aliasUsages.find(a => a.value == aliasDeclaration.value);
        if (!finded) {
            let diagnostic: Diagnostic = {
                message: "This alias is never used",
                range: aliasDeclaration.range,
                severity: DiagnosticSeverity.Warning
            }
            diagnostics.push(diagnostic);
            problems.current++;
        }
    }

    setAliasUse(aliasUsages)
}
function rangeFromMatch(match: RegExpExecArray, textDocument: TextDocument): Range {
    return {
        start: textDocument.positionAt(match.index),
        end: textDocument.positionAt(match.index + match[0].length),
    }
}