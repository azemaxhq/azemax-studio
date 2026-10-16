import type * as Monaco from 'monaco-editor';

/**
 * Azemax Midnight Blue — VS Code Dark+ syntax token colors.
 *
 * SYNTAX SOURCE OF TRUTH
 * ----------------------
 * Token foregrounds below reproduce the VS Code **Dark+** theme
 * (`extensions/theme-defaults/themes/dark_plus.json`, which includes
 * `dark_vs.json`) as faithfully as Monaco's Monarch token stream allows:
 *
 *   Dark+ tokenColors (dark_vs.json + dark_plus.json overrides):
 *     comment ......................... #6A9955  (green, italic)
 *     keyword / storage / storage.type  #569CD6  (blue)
 *     keyword.control (dark_plus) ..... #C586C0  (purple)
 *     string .......................... #CE9178  (warm tan)
 *     constant.numeric ................ #B5CEA8  (sage)
 *     keyword.operator ................ #D4D4D4  (editor foreground)
 *     variable / entity.name.variable . #9CDCFE  (light blue)
 *     variable.other.constant ......... #4FC1FF  (bright blue)
 *     entity.name.function ............ #DCDCAA  (pale yellow)
 *     types (entity.name.type etc.) ... #4EC9B0  (teal)
 *     default text .................... #D4D4D4
 *     semantic: numberLiteral #b5cea8, stringLiteral #ce9178,
 *               newOperator #C586C0, customLiteral #DCDCAA
 *
 * MONARCH TOKEN-MATCHING NOTES (verified against the Monarch engine in
 * `monaco-editor@0.55.1`: `ThemeTrieElement.match` does prefix matching on
 * dot-separated token segments and IGNORES trailing segments, so a rule for
 * `keyword.if` also matches `keyword.if.cs` / `keyword.if.java` / ...).
 * ---------------------------------------------------------------------------
 * - Every language's tokenizer appends a `tokenPostfix` (`.cs`, `.java`,
 *   `.ts`, `.js`, `.py`, …) to its tokens. The theme never needs per-language
 *   postfix variants — e.g. `type` matches `type.cs`, `type.identifier.ts`.
 * - Monarch emits bare `keyword` for most keywords in TS/JS/Python and
 *   `keyword.<word>` in C#/Java. Azemax's companion tokenizer shims emit
 *   `keyword.<word>` for every language so that control-flow keywords can be
 *   colored purple (#C586C0) exactly like Dark+'s `keyword.control` scope,
 *   while type/storage keywords stay blue (#569CD6) like Dark+'s
 *   `keyword`/`storage` scopes.
 * - `function` tokens come from the shims' call-site lookahead rules and map
 *   to Dark+'s `entity.name.function` (#DCDCAA). `type.identifier` tokens come
 *   from the shims' PascalCase rules and map to Dark+'s type scopes (#4EC9B0).
 * - `identifier` maps to Dark+'s `variable` (#9CDCFE light blue) — plain
 *   locals, parameters, and properties are light blue in Dark+, NOT the
 *   editor foreground.
 * - Operator/punctuation delimiters keep the vs-dark defaults (foreground
 *   #DCDCDC-ish via `delimiter` → #D4D4D4): Dark+ renders brackets and
 *   operators in the editor foreground. Bracket PAIR colorization
 *   (gold/purple/blue) is Monaco's own `editorBracketHighlight.*` default
 *   palette — the same one VS Code ships — and is intentionally preserved.
 *
 * UI COLORS (Azemax identity, unchanged):
 *   editor.background #080F1C (Midnight Blue), selection/cursor/indent
 *   guides/whitespace colors below are the pre-existing Azemax values.
 */
export const AZEMAX_DARKPLUS_THEME_ID = 'azemax-midnight-signature';

export function defineAzemaxDarkPlusTheme(monaco: typeof Monaco): void {
    monaco.editor.defineTheme(AZEMAX_DARKPLUS_THEME_ID, {
        base: 'vs-dark',
        inherit: true,
        rules: [
            /* ── Default text (Crisp Cool White #DCE2EB) ── */
            { token: '', foreground: 'DCE2EB' },
            { token: 'source', foreground: 'DCE2EB' },
            { token: 'white', foreground: 'DCE2EB' },

            /* ── Identifiers: Crisp Cool White #DCE2EB ── */
            { token: 'identifier', foreground: 'DCE2EB' },
            { token: 'variable', foreground: 'DCE2EB' },
            { token: 'variable.member', foreground: 'DCE2EB' },
            { token: 'variable.parameter', foreground: 'DCE2EB' },
            { token: 'variable.other', foreground: 'DCE2EB' },
            { token: 'variable.other.constant', foreground: '5D8FFF' },
            { token: 'variable.other.enummember', foreground: '5D8FFF' },
            { token: 'variable.language', foreground: '5D8FFF' },
            { token: 'variable.predefined', foreground: '5D8FFF' },

            /* ── Comments: Muted Blue-Gray / Secondary #8490A3 ── */
            { token: 'comment', foreground: '8490A3', fontStyle: 'italic' },
            { token: 'comment.doc', foreground: '8490A3', fontStyle: 'italic' },
            { token: 'comment.line', foreground: '8490A3', fontStyle: 'italic' },
            { token: 'comment.block', foreground: '8490A3', fontStyle: 'italic' },

            /* ── Keywords: Electric Blue #5D8FFF ── */
            { token: 'keyword', foreground: '5D8FFF' },
            { token: 'keyword.declaration', foreground: '5D8FFF' },
            { token: 'keyword.other', foreground: '5D8FFF' },
            { token: 'keyword.tag', foreground: '5D8FFF' },
            { token: 'storage', foreground: '5D8FFF' },
            { token: 'storage.type', foreground: '5D8FFF' },
            { token: 'storage.modifier', foreground: '5D8FFF' },
            { token: 'constant', foreground: '5D8FFF' },
            { token: 'constant.language', foreground: '5D8FFF' },
            { token: 'support.constant', foreground: '5D8FFF' },

            /* Control flow keywords: Electric Blue #5D8FFF */
            { token: 'keyword.if', foreground: '5D8FFF' },
            { token: 'keyword.else', foreground: '5D8FFF' },
            { token: 'keyword.elif', foreground: '5D8FFF' },
            { token: 'keyword.for', foreground: '5D8FFF' },
            { token: 'keyword.foreach', foreground: '5D8FFF' },
            { token: 'keyword.while', foreground: '5D8FFF' },
            { token: 'keyword.do', foreground: '5D8FFF' },
            { token: 'keyword.switch', foreground: '5D8FFF' },
            { token: 'keyword.case', foreground: '5D8FFF' },
            { token: 'keyword.default', foreground: '5D8FFF' },
            { token: 'keyword.when', foreground: '5D8FFF' },
            { token: 'keyword.try', foreground: '5D8FFF' },
            { token: 'keyword.catch', foreground: '5D8FFF' },
            { token: 'keyword.finally', foreground: '5D8FFF' },
            { token: 'keyword.throw', foreground: '5D8FFF' },
            { token: 'keyword.return', foreground: '5D8FFF' },
            { token: 'keyword.break', foreground: '5D8FFF' },
            { token: 'keyword.continue', foreground: '5D8FFF' },
            { token: 'keyword.goto', foreground: '5D8FFF' },
            { token: 'keyword.new', foreground: '5D8FFF' },
            { token: 'keyword.await', foreground: '5D8FFF' },
            { token: 'keyword.yield', foreground: '5D8FFF' },
            { token: 'keyword.using', foreground: '5D8FFF' },
            { token: 'keyword.import', foreground: '5D8FFF' },
            { token: 'keyword.other.import', foreground: 'DCE2EB' },
            { token: 'keyword.other.package', foreground: 'DCE2EB' },
            { token: 'keyword.from', foreground: '5D8FFF' },
            { token: 'keyword.export', foreground: '5D8FFF' },
            { token: 'keyword.flow', foreground: '5D8FFF' },
            { token: 'keyword.control', foreground: '5D8FFF' },
            { token: 'keyword.with', foreground: '5D8FFF' },
            { token: 'keyword.pass', foreground: '5D8FFF' },
            { token: 'keyword.raise', foreground: '5D8FFF' },
            { token: 'keyword.del', foreground: '5D8FFF' },
            { token: 'keyword.except', foreground: '5D8FFF' },
            { token: 'keyword.assert', foreground: '5D8FFF' },

            /* Word operators */
            { token: 'keyword.as', foreground: '5D8FFF' },
            { token: 'keyword.in', foreground: '5D8FFF' },
            { token: 'keyword.is', foreground: '5D8FFF' },
            { token: 'keyword.of', foreground: '5D8FFF' },
            { token: 'keyword.satisfies', foreground: '5D8FFF' },
            { token: 'keyword.infer', foreground: '5D8FFF' },
            { token: 'keyword.keyof', foreground: '5D8FFF' },
            { token: 'keyword.instanceof', foreground: '5D8FFF' },
            { token: 'keyword.typeof', foreground: '5D8FFF' },
            { token: 'keyword.operator.await', foreground: '5D8FFF' },
            { token: 'keyword.operator.as', foreground: '5D8FFF' },
            { token: 'keyword.operator.is', foreground: '5D8FFF' },

            /* ── Types: Clean Electric Blue #5D8FFF / Cyan ── */
            { token: 'type', foreground: '5D8FFF' },
            { token: 'type.identifier', foreground: '5D8FFF' },
            { token: 'type.annotation', foreground: '5D8FFF' },
            { token: 'typeParameter', foreground: '5D8FFF' },
            { token: 'class', foreground: '5D8FFF' },
            { token: 'interface', foreground: '5D8FFF' },
            { token: 'enum', foreground: '5D8FFF' },
            { token: 'namespace', foreground: '5D8FFF' },
            { token: 'struct', foreground: '5D8FFF' },
            { token: 'support.type', foreground: '5D8FFF' },
            { token: 'support.class', foreground: '5D8FFF' },
            { token: 'entity.name.type', foreground: '5D8FFF' },
            { token: 'entity.name.class', foreground: '5D8FFF' },
            { token: 'entity.name.namespace', foreground: '5D8FFF' },
            { token: 'entity.other.inherited-class', foreground: '5D8FFF' },

            /* Primitive type keywords */
            { token: 'keyword.number', foreground: '5D8FFF' },
            { token: 'keyword.string', foreground: '5D8FFF' },
            { token: 'keyword.void', foreground: '5D8FFF' },
            { token: 'keyword.boolean', foreground: '5D8FFF' },
            { token: 'keyword.any', foreground: '5D8FFF' },
            { token: 'keyword.never', foreground: '5D8FFF' },
            { token: 'keyword.object', foreground: '5D8FFF' },
            { token: 'keyword.symbol', foreground: '5D8FFF' },
            { token: 'keyword.bigint', foreground: '5D8FFF' },
            { token: 'keyword.unknown', foreground: '5D8FFF' },
            { token: 'keyword.intrinsic', foreground: '5D8FFF' },
            { token: 'keyword.bool', foreground: '5D8FFF' },
            { token: 'keyword.byte', foreground: '5D8FFF' },
            { token: 'keyword.sbyte', foreground: '5D8FFF' },
            { token: 'keyword.short', foreground: '5D8FFF' },
            { token: 'keyword.ushort', foreground: '5D8FFF' },
            { token: 'keyword.int', foreground: '5D8FFF' },
            { token: 'keyword.uint', foreground: '5D8FFF' },
            { token: 'keyword.long', foreground: '5D8FFF' },
            { token: 'keyword.ulong', foreground: '5D8FFF' },
            { token: 'keyword.char', foreground: '5D8FFF' },
            { token: 'keyword.float', foreground: '5D8FFF' },
            { token: 'keyword.double', foreground: '5D8FFF' },
            { token: 'keyword.decimal', foreground: '5D8FFF' },
            { token: 'keyword.dynamic', foreground: '5D8FFF' },
            /* Python builtin types */
            { token: 'keyword.str', foreground: '5D8FFF' },
            { token: 'keyword.list', foreground: '5D8FFF' },
            { token: 'keyword.dict', foreground: '5D8FFF' },
            { token: 'keyword.tuple', foreground: '5D8FFF' },
            { token: 'keyword.set', foreground: '5D8FFF' },
            { token: 'keyword.bytes', foreground: '5D8FFF' },
            { token: 'keyword.frozenset', foreground: '5D8FFF' },
            { token: 'keyword.bytearray', foreground: '5D8FFF' },
            { token: 'keyword.complex', foreground: '5D8FFF' },

            /* ── Functions/methods: Bright Blue / Clean Cool-White #5D8FFF ── */
            { token: 'function', foreground: '5D8FFF' },
            { token: 'function.method', foreground: '5D8FFF' },
            { token: 'function.builtin', foreground: '5D8FFF' },
            { token: 'method', foreground: '5D8FFF' },
            { token: 'method.call', foreground: '5D8FFF' },
            { token: 'entity.name.function', foreground: '5D8FFF' },
            { token: 'support.function', foreground: '5D8FFF' },

            /* ── Strings: Rich Green #8CCF9F ── */
            { token: 'string', foreground: '8CCF9F' },
            { token: 'string.quote', foreground: '8CCF9F' },
            { token: 'string.single', foreground: '8CCF9F' },
            { token: 'string.double', foreground: '8CCF9F' },
            { token: 'string.template', foreground: '8CCF9F' },
            { token: 'string.other', foreground: '8CCF9F' },
            { token: 'string.special', foreground: '8CCF9F' },
            { token: 'string.key', foreground: 'DCE2EB' },
            { token: 'string.value', foreground: '8CCF9F' },
            { token: 'string.escape', foreground: 'FFD600' },
            { token: 'string.regexp', foreground: '8CCF9F' },

            /* ── Numbers: Clean Bright Cool White / Sage ── */
            { token: 'number', foreground: 'DCE2EB' },
            { token: 'number.float', foreground: 'DCE2EB' },
            { token: 'number.hex', foreground: 'DCE2EB' },
            { token: 'number.octal', foreground: 'DCE2EB' },
            { token: 'number.binary', foreground: 'DCE2EB' },
            { token: 'constant.numeric', foreground: 'DCE2EB' },
            { token: 'constant.character', foreground: '5D8FFF' },

            /* ── Operators/punctuation: Muted Gray-Blue #8490A3 ── */
            { token: 'operator', foreground: '8490A3' },
            { token: 'operator.overloaded', foreground: '8490A3' },
            { token: 'delimiter', foreground: '8490A3' },

            /* ── Brackets: Bright Yellow #FFD600 ── */
            { token: 'delimiter.bracket', foreground: 'FFD600' },
            { token: 'delimiter.curly', foreground: 'FFD600' },
            { token: 'delimiter.parenthesis', foreground: 'FFD600' },
            { token: 'delimiter.square', foreground: 'FFD600' },
            { token: 'delimiter.angle', foreground: '8490A3' },

            /* ── Tags/attributes (HTML/XML) ── */
            { token: 'tag', foreground: '5D8FFF' },
            { token: 'tag.python', foreground: '5D8FFF' },
            { token: 'tag.id', foreground: '5D8FFF' },
            { token: 'tag.class', foreground: '5D8FFF' },
            { token: 'metatag', foreground: '5D8FFF' },
            { token: 'metatag.content', foreground: 'DCE2EB' },
            { token: 'attribute.name', foreground: '5D8FFF' },
            { token: 'attribute.value', foreground: '8CCF9F' },
            { token: 'attribute.value.number', foreground: 'DCE2EB' },
            { token: 'attribute.value.unit', foreground: 'DCE2EB' },
            { token: 'attribute.value.string', foreground: '8CCF9F' },
            { token: 'key', foreground: 'DCE2EB' },

            /* ── Annotations & regexp ── */
            { token: 'annotation', foreground: '5D8FFF' },
            { token: 'annotation.decorator', foreground: '5D8FFF' },
            { token: 'regexp', foreground: '8CCF9F' },
            { token: 'regexp.escape', foreground: 'FFD600' },
            { token: 'regexp.control', foreground: 'FFD600' },
            { token: 'regexp.invalid', foreground: 'F44747' },
            { token: 'invalid', foreground: 'F44747' },
        ],
        colors: {
            'editor.background': '#10141B',
            'editor.foreground': '#DCE2EB',
            'editorLineNumber.foreground': '#3E4F6B',
            'editorLineNumber.activeForeground': '#A5B5CD',
            'editor.lineHighlightBackground': '#171C25',
            'editor.lineHighlightBorder': '#00000000',
            'editorCursor.foreground': '#5D8FFF',
            'editor.selectionBackground': '#5D8FFF40',
            'editor.inactiveSelectionBackground': '#5D8FFF20',
            'editorIndentGuide.background1': '#252D39',
            'editorIndentGuide.background': '#252D39',
            'editorIndentGuide.activeBackground1': '#3E4D63',
            'editorIndentGuide.activeBackground': '#3E4D63',
            'editorBracketPairGuide.background1': '#252D39',
            'editorBracketPairGuide.background2': '#252D39',
            'editorBracketPairGuide.background3': '#252D39',
            'editorBracketPairGuide.background4': '#252D39',
            'editorBracketPairGuide.activeBackground1': '#3E4D63',
            'editorBracketPairGuide.activeBackground2': '#3E4D63',
            'editorBracketMatch.background': '#202B43',
            'editorBracketMatch.border': '#405B91',
            'editorBracketHighlight.foreground1': '#FFD600',
            'editorBracketHighlight.foreground2': '#FFD600',
            'editorBracketHighlight.foreground3': '#FFD600',
            'editorBracketHighlight.foreground4': '#FFD600',
            'editorBracketHighlight.foreground5': '#FFD600',
            'editorBracketHighlight.foreground6': '#FFD600',
            'editorGutter.background': '#10141B',
            'editorGutter.modifiedBackground': '#5D8FFF',
            'scrollbarSlider.background': '#252D3966',
            'scrollbarSlider.hoverBackground': '#252D3999',
            'scrollbarSlider.activeBackground': '#252D39CC',
            'editorOverviewRuler.border': '#10141B',
            'editorRuler.foreground': '#252D39',
            'editor.findMatchBackground': '#5D8FFF66',
            'editor.findMatchHighlightBackground': '#5D8FFF33',
            'editor.foldBackground': '#171C25',
            'editorStickyScroll.background': '#10141B',
            'editorStickyScroll.border': '#252D39',
            'editorWidget.background': '#10141B',
            'editorWidget.border': '#252D39',
            'editorHoverWidget.background': '#10141B',
            'editorHoverWidget.border': '#252D39',
            'editorSuggestWidget.background': '#10141B',
            'editorSuggestWidget.border': '#252D39',
            'editorSuggestWidget.selectedBackground': '#171C25',
            'minimap.background': '#10141B',
        },
    });
}
