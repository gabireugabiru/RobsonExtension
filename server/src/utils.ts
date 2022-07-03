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