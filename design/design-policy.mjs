/**
 * design-policy — one always-on prompt section.
 *
 * Why a plugin and not more persona text: the persona says WHO this agent is (a
 * graphic designer working in a measured visual language). This section says HOW
 * it works — intent before form, measure before judging, never ship an
 * unverified render. Keeping them apart lets either be revised without
 * disturbing the other, and it puts the discipline in context from the first
 * step rather than only after a skill has been loaded.
 *
 * THE TEXT IS CONFIGURATION, NOT CODE
 * -----------------------------------
 * It arrives as `config.text` from `agent.cordis.yml`. That is deliberate: a
 * standing mount is rebuilt from a composition-file stamp whenever a new
 * session starts, so a YAML edit takes effect on the next session with no Host
 * restart. Text baked into this module would not — the Cordis Loader imports a
 * local plugin with a plain `await import(url)` and no cache-busting
 * parameter, so one process evaluates any given `.mjs` exactly once and a
 * rebuilt generation would keep serving the old string.
 *
 * Plane: this row only CONSUMES `systemPrompt`, the same registry the preset's
 * persona row consumes. It publishes no service, so it needs no isolate realm
 * and is correct as a loose top-level row.
 */

/** The prompt registry this row contributes a section to. */
export const inject = ['systemPrompt']

/** The section name this row owns inside the preset's scope. */
const SECTION_NAME = 'design:working-policy'

/**
 * Order: immediately after the persona. The registry owns the placement of its
 * own named sections, so the number is derived from the persona's slot rather
 * than hardcoded — it lands between DEPLOYMENT_PERSONA (0) and PLAN_POLICY
 * (500), which is exactly where a section qualifying the identity belongs.
 */
const POLICY_ORDER_OFFSET = 100

/**
 * Register the policy section into the mounting scope.
 *
 * @param {object} ctx the preset's standing scope context
 * @param {{text?: string}} [config] supplied by the composition file
 */
export function apply(ctx, config) {
  const text = config === undefined ? undefined : config.text
  // Both guards fail the mount loudly rather than degrading quietly. A preset
  // that renders no working policy is worse than one that refuses to load,
  // because nothing downstream would report the loss — the agent would simply
  // design without discipline and every output would look plausible.
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(
      'design-policy: config.text must be a non-empty string; the policy text lives in agent.cordis.yml',
    )
  }
  if (text.includes('{{')) {
    throw new Error(
      'design-policy: config.text must not contain "{{" — prompt sections are scanned for variable references and an unknown one fails the whole assembly',
    )
  }
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA') + POLICY_ORDER_OFFSET,
        text,
      }),
    'design-policy.section()',
  )
}
