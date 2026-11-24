// Re-export of the shared session model (public/js/session.js is a classic script that also
// sets module.exports), so the Worker bundle and tests can import it.
import SessionModel from '../../public/js/session.js';
export default SessionModel;
