/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable  */

// We expect that our Rollup, Jest, and Flow configurations
// always shim this module with the corresponding host config
// (either provided by a renderer, or a generic shim for npm).
//
// We should never resolve to this file, but it exists to make
// sure that if we *do* accidentally break the configuration,
// the failure isn't silent.

// throw new Error('This module must be shimmed by a specific renderer.');

// sy
export * from './forks/ReactFiberHostConfig.dom';
export {
  shouldSetTextContent,
  supportsHydration,
  supportsSingletons,
  isHydratable,
  canHydrateInstance,
  canHydrateTextInstance,
  canHydrateSuspenseInstance,
  getNextHydratableSibling,
  getFirstHydratableChild,
  getFirstHydratableChildWithinContainer,
  getFirstHydratableChildWithinSuspenseInstance,
  hydrateInstance,
  hydrateTextInstance,
  hydrateSuspenseInstance,
  getNextHydratableInstanceAfterSuspenseInstance,
  shouldDeleteUnhydratedTailInstances,
  didNotMatchHydratedContainerTextInstance,
  didNotMatchHydratedTextInstance,
  didNotHydrateInstanceWithinContainer,
  didNotHydrateInstanceWithinSuspenseInstance,
  didNotHydrateInstance,
  didNotFindHydratableInstanceWithinContainer,
  didNotFindHydratableTextInstanceWithinContainer,
  didNotFindHydratableSuspenseInstanceWithinContainer,
  didNotFindHydratableInstanceWithinSuspenseInstance,
  didNotFindHydratableTextInstanceWithinSuspenseInstance,
  didNotFindHydratableSuspenseInstanceWithinSuspenseInstance,
  didNotFindHydratableInstance,
  didNotFindHydratableTextInstance,
  didNotFindHydratableSuspenseInstance,
  resolveSingletonInstance,
  getPublicInstance,
  supportsMutation,
  supportsPersistence,
  supportsHydration,
  supportsResources,
  supportsSingletons,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  replaceContainerChildren,
  createContainerChildSet,
  hideInstance,
  hideTextInstance,
  unhideInstance,
  unhideTextInstance,
  commitHydratedContainer,
  commitHydratedSuspenseInstance,
  clearContainer,
  prepareScopeUpdate,
  prepareForCommit,
  beforeActiveInstanceBlur,
  detachDeletedInstance,
  clearSingleton,
  acquireSingletonInstance,
  releaseSingletonInstance,
  scheduleMicrotask,
  afterActiveInstanceBlur,
} from 'react-dom-bindings/src/client/ReactDOMHostConfig';

// export {
//   getResource,
//   acquireResource,
//   releaseResource,
// } from 'react-dom-bindings/src/client/ReactDOMFloatClient';

// export type {
//   Instance,
//   TextInstance,
//   SuspenseInstance,
//   Container,
//   ChildSet,
//   UpdatePayload,
// } from 'react-dom-bindings/src/client/ReactDOMHostConfig';

// export * from 'react-dom-bindings/src/client/ReactDOMHostConfig';
