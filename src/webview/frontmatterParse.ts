// Thin re-export. The real parser/serializer lives in `../frontmatterYaml`
// so both bundles can use it (cross-bundle pattern; see `imageDisplayPath.ts`).
export { parseFrontmatter, serializeFrontmatter, type ParsedEntry } from '../frontmatterYaml';
