import type { z } from 'zod';

import type * as S from './game_data/schema';

/*
 * Game data types, inferred from the zod schemas in
 * src/api/game_data/schema.ts, which are the source of truth (field docs are
 * the schemas' `.describe()` text, also in the generated schema/*.schema.json).
 * Spec: docs/specs/data_schema_spec_2026-10-17.md.
 */

type Infer<T extends z.ZodType> = z.infer<T>;

export type Slug = Infer<typeof S.SlugSchema>;
/** An expression in the Force Org expression language (docs/specs/expression_language_spec_2026-10-17.md) */
export type Expr = Infer<typeof S.ExprSchema>;
/** A plain number, or an expression that evaluates to one */
export type NumberOrExpr = Infer<typeof S.NumberOrExprSchema>;
export type VersionRange = Infer<typeof S.VersionRangeSchema>;
/** resource id → amount, e.g. `{ "points": 100 }` */
export type Costs = Infer<typeof S.CostsSchema>;
export type Named = Infer<typeof S.NamedSchema>;
/** A rule's condition plus the player-facing reason shown when it isn't met */
export type Condition = Infer<typeof S.ConditionSchema>;

export type SourceManifest = Infer<typeof S.SourceManifestSchema>;
export type ProvidedGame = Infer<typeof S.ProvidedGameSchema>;
export type GameExtension = Infer<typeof S.GameExtensionSchema>;

export type GameSystem = Infer<typeof S.GameSystemSchema>;
export type BuiltInScope = (typeof S.BUILT_IN_SCOPES)[number];
export type TermScope = Infer<typeof S.BuiltInScopeSchema>;
export type TermKey = Infer<typeof S.TermKeySchema>;
export type Term = Infer<typeof S.TermSchema>;
export type Role = Infer<typeof S.RoleSchema>;
export type UnitType = Infer<typeof S.UnitTypeSchema>;
export type SubType = Infer<typeof S.SubTypeSchema>;
export type Trait = Infer<typeof S.TraitSchema>;
export type GroupType = Infer<typeof S.GroupTypeSchema>;
export type SlotTag = Infer<typeof S.SlotTagSchema>;
export type Resource = Infer<typeof S.ResourceSchema>;
export type CostTarget = Infer<typeof S.CostTargetSchema>;
export type StatTemplate = Infer<typeof S.StatTemplateSchema>;
export type StatDefinition = Infer<typeof S.StatDefinitionSchema>;
export type ListChoice = Infer<typeof S.ListChoiceSchema>;
export type ListChoiceValue = Infer<typeof S.ListChoiceValueSchema>;
export type ListChoiceValueEffect = Infer<typeof S.ListChoiceValueEffectSchema>;

export type ListRule = Infer<typeof S.ListRuleSchema>;
export type ResourceCapRule = Infer<typeof S.ResourceCapRuleSchema>;
export type CountRule = Infer<typeof S.CountRuleSchema>;
export type ExpressionListRule = Infer<typeof S.ExpressionListRuleSchema>;

export type Faction = Infer<typeof S.FactionSchema>;
export type FactionRecords = Infer<typeof S.FactionRecordsSchema>;
export type SubFaction = Infer<typeof S.SubFactionSchema>;
export type SubFactionGroup = Infer<typeof S.SubFactionGroupSchema>;
export type UnitModifier = Infer<typeof S.UnitModifierSchema>;
export type UnitModifierAction = Infer<typeof S.UnitModifierActionSchema>;

export type Unit = Infer<typeof S.UnitSchema>;
export type CompositionBlock = Infer<typeof S.CompositionBlockSchema>;
export type UnitProfile = Infer<typeof S.UnitProfileSchema>;
export type Weapon = Infer<typeof S.WeaponSchema>;
export type WeaponProfile = Infer<typeof S.WeaponProfileSchema>;
export type Equipment = Infer<typeof S.EquipmentSchema>;
export type SpecialRule = Infer<typeof S.SpecialRuleSchema>;
export type SpecialRuleSelection = Infer<typeof S.SpecialRuleSelectionSchema>;
export type GearKind = Infer<typeof S.GearKindSchema>;
export type GearRef = Infer<typeof S.GearRefSchema>;
export type DefaultGear = Infer<typeof S.DefaultGearSchema>;

export type Upgrade = Infer<typeof S.UpgradeSchema>;
export type FactionUpgrade = Infer<typeof S.FactionUpgradeSchema>;
export type UpgradeReference = Infer<typeof S.UpgradeReferenceSchema>;
export type PerModelConfig = Infer<typeof S.PerModelConfigSchema>;
export type Option = Infer<typeof S.OptionSchema>;
export type SubChoice = Infer<typeof S.SubChoiceSchema>;
export type SubChoiceValue = Infer<typeof S.SubChoiceValueSchema>;
export type Restrictions = Infer<typeof S.RestrictionsSchema>;
export type GearCondition = Infer<typeof S.GearConditionSchema>;
export type GearLimit = Infer<typeof S.GearLimitSchema>;
export type GearSwap = Infer<typeof S.GearSwapSchema>;

export type ProfileFilter = Infer<typeof S.ProfileFilterSchema>;
export type UnitSelector = Infer<typeof S.UnitSelectorSchema>;
export type UnitExclusion = Infer<typeof S.UnitExclusionSchema>;
export type SelectorRef = Infer<typeof S.SelectorRefSchema>;
export type UnitSelectorOrRef = Infer<typeof S.UnitSelectorOrRefSchema>;
export type NamedSelector = Infer<typeof S.NamedSelectorSchema>;
export type StatChange = Infer<typeof S.StatChangeSchema>;
export type StatEffect = Infer<typeof S.StatEffectSchema>;
export type SpecialRuleEffect = Infer<typeof S.SpecialRuleEffectSchema>;
export type TraitEffect = Infer<typeof S.TraitEffectSchema>;
/** Tags the slot holding the unit (validator 2.2.0) */
export type SlotTagEffect = Infer<typeof S.SlotTagEffectSchema>;

export type Group = Infer<typeof S.GroupSchema>;
export type GroupEffect = Infer<typeof S.GroupEffectSchema>;
export type Slot = Infer<typeof S.SlotSchema>;
export type SlotSource = Infer<typeof S.SlotSourceSchema>;
/** A stat, special-rule or trait effect on a unit */
export type UnitEffect = Infer<typeof S.UnitEffectSchema>;
/** A unit effect or a slot-tag effect: what everything but a slot option may apply (validator 2.2.0) */
export type HeldUnitEffect = Infer<typeof S.HeldUnitEffectSchema>;
export type SlotUnitEffect = Infer<typeof S.SlotUnitEffectSchema>;
export type TagOptions = Infer<typeof S.TagOptionsSchema>;
export type AddedSlot = Infer<typeof S.AddedSlotSchema>;
export type GroupRequirement = Infer<typeof S.GroupRequirementSchema>;

export type SlotEffect = Infer<typeof S.SlotEffectSchema>;
export type AllowedRolesEffect = Infer<typeof S.AllowedRolesEffectSchema>;
export type SlotOptionEffect = Infer<typeof S.SlotOptionEffectSchema>;
export type SlotOption = Infer<typeof S.SlotOptionSchema>;
