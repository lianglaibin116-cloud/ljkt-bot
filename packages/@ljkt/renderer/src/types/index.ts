// The slide object model is the canonical contract from @ljkt/dsl. The renderer
// no longer vendors its own copy; it re-exports the DSL types here so the public
// `@ljkt/renderer/types` surface stays intact.
export * from '@ljkt/dsl';
export * from './effects';
