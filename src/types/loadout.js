export function uid(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
export function now() {
    return Date.now();
}
