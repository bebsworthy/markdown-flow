// src/events/index.ts
//
// Barrel for the events pure surface.

export type {
  EventKindGroup,
  EventsFilter,
  EventsPanelEmptyReason,
  EventsPanelModel,
  EventsPanelRow,
  EventsPanelSettings,
  EventsPanelState,
  EventsReducerAction,
} from "./types.js";
export {
  buildSearchHaystack,
  formatEventKind,
  formatEventRow,
  formatEventTimestamp,
  roleForGroup,
  summariseEvent,
} from "./format.js";
export { eventNodeId, groupForType, matchesFilter } from "./filter.js";
export { mergeEventSources } from "./merge.js";
export {
  eventsReducer,
  eventsSincePause,
  initialEventsPanelState,
} from "./reducer.js";
export { deriveEventsModel, emptyReasonLabel } from "./derive.js";
