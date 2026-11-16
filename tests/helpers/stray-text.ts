/**
 * Component: Test helper for stray text nodes (e.g. a bare "0" from `count && (...)`)
 * Documentation: documentation/frontend/components.md
 */

/** Text nodes under `root` whose trimmed content is exactly `text`. */
export function textNodesEqualTo(root: Node, text: string): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() === text) found.push(node as Text);
  }
  return found;
}
