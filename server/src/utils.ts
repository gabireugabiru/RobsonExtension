export function lowerAlias(to_lower: string): string {
    let lowercase = to_lower.replace(/([A-Z])/g, "_$1").toLocaleLowerCase();
    if (lowercase[0] === "_") {
        lowercase = lowercase.slice(1, lowercase.length);
    }
    if (lowercase[0] === ":") {
        let sliced = lowercase.slice(1, lowercase.length);
        if (sliced[0] == "_") {
            lowercase = `:${sliced.slice(1, sliced.length)}`
        }
    }
    return lowercase
}
export function removeComments(string: string): string {
    const removed_comments = string.split(";");
    if (removed_comments.length > 0) {
        string = removed_comments[0];
    }
    return string.trim()
}


export function getOpcode(string: string): number {
    let opcode = 0;
    const removed_comments = removeComments(string);
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
function validParam() {

}
export const parameterCount = {
    1: 3,
    2: 3,
    3: 1,
    4: 3,
    5: 1,
    6: 3,
    7: 0,
    8: 0,
    9: 1,
    10: 1,
    11: 0,
    12: 1,
    13: 1,
    14: 0,
    15: 1
}
export const labels = {
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