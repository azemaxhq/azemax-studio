/**
 * Regression tests for settings import validation + coercion.
 * A corrupt settings file must be REJECTED (never silently wipe config), and
 * garbage values must coerce to defaults without throwing.
 *
 * Run with: npx tsx tests/settings.test.ts
 */
import { check, finish } from './_harness';
import { parseImportedSettings, sanitizeSettings } from '../src/settings/settingsValidation';
import type { Settings } from '../src/types/settings';

// A valid, complete settings object (structural copy of defaults).
const validSettings = (): Record<string, unknown> => JSON.parse(JSON.stringify(sanitizeSettings(null)));

{
    check('import: invalid JSON rejected', parseImportedSettings('not json').ok === false);
    check('import: array rejected', parseImportedSettings('[]').ok === false);
    check('import: number rejected', parseImportedSettings('42').ok === false);

    const unknownSection = parseImportedSettings('{"bogus": {}}');
    check('import: unknown section rejected', unknownSection.ok === false);

    const valid = validSettings();
    const ok = parseImportedSettings(JSON.stringify(valid));
    check('import: full valid import accepted', ok.ok === true);

    // Out-of-range number (editor.fontSize has min 8 / max 32).
    const bad = validSettings();
    bad.editor.fontSize = 999;
    const res = parseImportedSettings(JSON.stringify(bad));
    check('import: out-of-range number rejected', res.ok === false);

    // Invalid select value.
    const badSelect = validSettings();
    badSelect.general.theme = 'rainbow';
    const sel = parseImportedSettings(JSON.stringify(badSelect));
    check('import: invalid select rejected', sel.ok === false);

    // Wrong type for boolean.
    const badBool = validSettings();
    badBool.general.restoreSession = 'yes';
    const resBool = parseImportedSettings(JSON.stringify(badBool));
    check('import: wrong boolean type rejected', resBool.ok === false);

    // Partial import: missing sections fall back to defaults.
    const partial = parseImportedSettings(JSON.stringify({ general: { theme: 'dark' } }));
    check('import: partial import accepted', partial.ok === true && partial.settings.general.theme === 'dark');
    check('import: missing sections defaulted', partial.settings.terminal !== undefined);

    // Unknown key within a known section rejected.
    const unknownKey = parseImportedSettings(JSON.stringify({ general: { theme: 'dark', magic: 1 } }));
    check('import: unknown key rejected', unknownKey.ok === false);
}

{
    // sanitizeSettings never throws, coerces garbage to defaults.
    const coerced = sanitizeSettings('garbage');
    check('coerce: non-object -> defaults', coerced.general.theme === 'dark');

    const mixed = sanitizeSettings({
        general: { theme: 'rainbow', restoreSession: 'nope' },
        editor: { fontSize: 'big', fontFamily: 'monospace' },
    });
    check('coerce: invalid select -> default', mixed.general.theme === 'dark');
    check('coerce: invalid boolean -> default', mixed.general.restoreSession === true);
    check('coerce: valid string survives', mixed.editor.fontFamily === 'monospace');
    check('coerce: result is a full Settings object', (mixed as Settings).terminal !== undefined);
}

finish('settings');
