export function generateToken(userId: string): string {
}

export function getUserFromToken(token: string): User | null {
}

export function setAuthCookie(res: ServerResponse, token: string) {
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
}
