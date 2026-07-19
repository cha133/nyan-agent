type SessionWithActiveTurn = { id: string; status: string; activeTurnId?: string };

export function activeTurnFromSessions(sessions: readonly SessionWithActiveTurn[]): { sessionId: string; turnId: string } | undefined {
  const running = sessions.find((session) => session.status === "running" && session.activeTurnId);
  return running?.activeTurnId ? { sessionId: running.id, turnId: running.activeTurnId } : undefined;
}
