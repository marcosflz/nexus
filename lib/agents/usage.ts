/** Tokens consumidos por un turno, tal y como los informa el motor. */
export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cache_read?: number;
  cache_write?: number;
}
