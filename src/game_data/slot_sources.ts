import type { SlotSource, SlotSources } from '../types';

/*
 * A slot's `source` is one faction or (validator 2.8.0) a list of them
 * (data schema spec §7.1). Consumers read it through this, so the two forms
 * mean the same thing everywhere.
 */

/** A slot's `source` as a list: one entry for the object form, none when left out */
export const slotSources = (
    source: SlotSources | undefined
): Array<SlotSource> =>
    source === undefined ? [] : Array.isArray(source) ? source : [source];
