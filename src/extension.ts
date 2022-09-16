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

function removeComments(string: string): string {
  const removed_comments = string.split(";");
  if (removed_comments.length > 0) {
    string = removed_comments[0];
  }
  return string.trim()
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

function multi_function_opcode(object: any, max: number, lines: string[], i: number): string {
  let label = "";
  let next = lines[i + 1];
  next = removeComments(next);
  next = next.trim();
  if (next.length != 0) {
    const splited = next.split(" ");
    if (splited.length > 0) {
      const value = Number(splited[1]);
      if (value < max) {
        label = object[value];
      }
    }
  }
  return label
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
  12: "load",
  13: "time",
  14: "flush",
  15: "terminal"
}
const operations = {
  0: "add",
  1: "sub",
  2: "mul",
  3: "div"
}
const time = {
  0: "count",
  1: "interval",
  2: "cmp_interval"
}
const terminal = {
  0: "raw",
  1: "clear",
  2: "poll",
  3: "togg_cursor",
  4: "mv_cursor"
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

      const text = document.getText();
      const hints: vscode.InlayHint[] = [];

      const lines = text.split("\n");

      console.log(lines);
      console.log(text);

      let index = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes("robson")) {
          const opcode = getOpcode(line);
          if (opcode == -1) {
            index += line.length + 1;
            continue
          }
          let label = (opcode < 1 || opcode > 15) ? "unknown" : labels[opcode];
          let new_label = "";
          if (opcode == 1) {
            new_label = multi_function_opcode(operations, 4, lines, i);
          } else if (opcode == 13) {
            new_label = multi_function_opcode(time, 3, lines, i);
          } else if (opcode == 15) {
            new_label = multi_function_opcode(terminal, 5, lines, i);
          }
          if (new_label != "") {
            label = new_label;
          }
          let before_spaces = 0;
          for (const char of line) {
            if (char === " ") {
              before_spaces++
            } else {
              break
            }
          }

          const position = document.positionAt(index + before_spaces);
          const hint: vscode.InlayHint = {
            label,
            position,
            kind: vscode.InlayHintKind.Type,
            paddingRight: true
          }
          hints.push(hint);
        }
        index += line.length + 1;
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
      var execution = new vscode.ShellExecution(`robson ${path} compile`);
      let task = new vscode.Task({ type }, vscode.TaskScope.Workspace,
        `Compile ${getFileName(path)}`, "Robson", execution);
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


