/**
 * recordsReducer  (v1)
 *
 * Pure reducer for the `records` array in MainApp.
 * Rules:
 *   - No side effects (no DB calls, no localStorage, no setSelId)
 *   - Input:  derived records (enriched with pr, paid, remaining, etc.)
 *   - Output: next derived records array
 *   - Callers handle all side-effects after dispatching
 */

export const RECORDS_ACTION = {
  ADD_RECORD:    "ADD_RECORD",
  UPDATE_RECORD: "UPDATE_RECORD",
  DELETE_RECORD: "DELETE_RECORD",
  LOAD_RECORDS:  "LOAD_RECORDS",   // replace entire list on initial fetch
};

/**
 * recordsReducer
 *
 * @param {Array}  state  - current array of derived records
 * @param {object} action - { type, payload }
 *   ADD_RECORD    payload: derived record object
 *   UPDATE_RECORD payload: derived record object (matched by id)
 *   DELETE_RECORD payload: record id string
 *   LOAD_RECORDS  payload: array of derived records (replaces state)
 * @returns {Array} next records array
 */
export function recordsReducer(state, action) {
  switch (action.type) {

    case RECORDS_ACTION.LOAD_RECORDS:
      return action.payload;

    case RECORDS_ACTION.ADD_RECORD:
      return [action.payload, ...state];

    case RECORDS_ACTION.UPDATE_RECORD:
      return state.map(r =>
        r.id === action.payload.id ? action.payload : r
      );

    case RECORDS_ACTION.DELETE_RECORD:
      return state.filter(r => r.id !== action.payload);

    default:
      return state;
  }
}


