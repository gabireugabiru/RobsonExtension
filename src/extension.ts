import * as path from "path";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { ExtensionContext, workspace } from "vscode";
import * as vscode from "vscode";
let client: LanguageClient;

function getFileName(path: string): string {
  const splited = path.split("/");
  const windowsSplited = path.split("\\");

  if (splited.length > windowsSplited.length) {
    if (splited.length === 0) {
      return path
    }
    return splited[splited.length - 1]
  } else {
    return windowsSplited[windowsSplited.length - 1]
  }
}

function getOpcode(string: string): number {
  let opcode = 0;
  const removed_comments = string.split(";");
  if (removed_comments.length > 0) {
    string = removed_comments[0];
  }
  const splited = string.trim().split(' ');
  for (const keyword of splited) {
    if (keyword.trim() == "robson") {
      opcode++;
    } else {
      opcode = -1;
      break;
    }
  }
  return opcode;
}

const labels = {
  1: "operation",
  2: "if lower",
  3: "push",
  4: "if equal",
  5: "vstack",
  6: "input",
  7: "print",
  8: "pnumber",
  9: "jump",
  10: "set",
  11: "pop",
  12: "load"
}

export function activate(context: ExtensionContext) {
  console.log("teste");

  // The server is implemented in node
  let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: 'file', language: 'robson' }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
    }
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'RobsonAnalyzer',
    'Robson Analyzer Server',
    serverOptions,
    clientOptions
  );

  // Start the client
  client.start();


  const provider: vscode.InlayHintsProvider<vscode.InlayHint> = {

    provideInlayHints(document, position, context) {
      console.log("triggered");

      const pattern = /^ *?robson *.*/gm

      let match: RegExpExecArray | null;

      const text = document.getText();
      const hints: vscode.InlayHint[] = [];
      while (match = pattern.exec(text)) {
        const stringMatch = match.toString();
        const opcode = getOpcode(stringMatch);
        if (opcode < 1 || opcode > 12) {
          continue;
        }
        let label = labels[opcode];
        let n_for_robson = 0;
        for (const char of stringMatch) {
          if (char === " ") {
            n_for_robson++
          } else {
            break
          }
        }
        const position = document.positionAt(match.index + n_for_robson);
        const hint: vscode.InlayHint = {
          label,
          position,
          kind: vscode.InlayHintKind.Type,
          paddingRight: true
        }
        hints.push(hint);
      }
      return hints as vscode.ProviderResult<vscode.InlayHint[]>;
    }
  }

  vscode.languages.registerInlayHintsProvider({ pattern: "**", language: "robson" }, provider);
  var type = "robson";
  vscode.tasks.registerTaskProvider(type, {
    provideTasks() {
      const path = vscode.window.activeTextEditor.document.uri.fsPath;
      vscode.window.activeTextEditor.document.save();
      var execution = new vscode.ShellExecution(`robson "${path}"`);
      let task = new vscode.Task({ type }, vscode.TaskScope.Workspace,
        `Execute ${getFileName(path)}`, "Robson", execution);
      task.group = vscode.TaskGroup.Build;
      return [
        task
      ];
    },
    resolveTask(task) {
      return task;
    }
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined
  }
  return client.stop()
}


