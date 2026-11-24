// Re-export of the shared session model (js/session.js is a classic script that also
// sets module.exports), so the Worker bundle and tests can import it.
import SessionModel from '../../js/session.js';
export default SessionModel;
