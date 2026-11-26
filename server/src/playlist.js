// Re-export of the shared playlist parser (public/js/playlist.js is a classic script that also
// sets module.exports), so the Worker validates links with the same code the form uses.
import PlaylistLink from '../../public/js/playlist.js';
export default PlaylistLink;
