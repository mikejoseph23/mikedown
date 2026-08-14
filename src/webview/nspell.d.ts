/**
 * Minimal ambient types for `nspell` (the package ships no `.d.ts`).
 * Only the surface MikeDown's spell checker uses is declared here.
 */
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
  }
  function nspell(aff: string, dic: string): NSpell;
  export default nspell;
}
