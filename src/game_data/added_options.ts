import type { FactionUpgrade, SubFaction } from '../types';

/*
 * A sub-faction's `addOptions` (validator 2.12.0, data schema spec §4.3):
 * options appended to the parent's faction upgrades, never replacing one.
 * Consumers apply them through this, after merging every taken sub-faction's
 * records (overrides included) and before unit modifiers, so `addUpgrade`
 * copies and UpgradeReferences see the extended lists.
 */

/**
 * The upgrades with each sub-faction's added options appended, in the order
 * given. An id the upgrade already has keeps the option it has: the checker
 * makes sure such an addition is identical, or reports it. Additions to an
 * upgrade that isn't there are left out. Never mutates the inputs.
 */
export function withAddedOptions<U extends Pick<FactionUpgrade, 'options'>>(
    upgrades: Record<string, U>,
    subFactions: ReadonlyArray<Pick<SubFaction, 'addOptions'>>
): Record<string, U> {
    let result = upgrades;
    for (const sub of subFactions) {
        for (const [id, added] of Object.entries(sub.addOptions ?? {})) {
            const upgrade = result[id];
            if (!upgrade) continue;
            const fresh = Object.entries(added).filter(
                ([optionId]) => !(optionId in upgrade.options)
            );
            if (!fresh.length) continue;
            if (result === upgrades) result = { ...upgrades };
            result[id] = {
                ...upgrade,
                options: { ...upgrade.options, ...Object.fromEntries(fresh) },
            };
        }
    }
    return result;
}
