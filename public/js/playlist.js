// PLAYLIST LINK
// Pure, DOM-free. Turns pasted text into a YouTube playlist ID, and an ID into the one link we show.
// Only the ID is kept. Nothing else the host typed is stored, sent to members or put in a link.
var PlaylistLink = (function() {
  var HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
  var MAX_INPUT = 300;
  var ID_RE = /^[A-Za-z0-9_-]{10,64}$/;   // real playlist IDs are 13+ characters; "LL" and "WL" are too short
  var PRIVATE_IDS = ['LL', 'WL', 'LM'];   // Liked videos, Watch later, Liked music: private to each account
  var SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
  var UNSAFE_RE = /[\u0000- \u007f-\u009f]/;   // whitespace and control characters
  var HTTP_RE = /^https?:\/\//i;

  var ERRORS = {
    empty: '// PASTE A YOUTUBE PLAYLIST LINK',
    tooLong: '// PLAYLIST LINK IS TOO LONG',
    notYoutube: '// PLAYLIST MUST BE A YOUTUBE LINK',
    noList: '// NO PLAYLIST FOUND IN THAT LINK',
    private: '// THAT LIST IS PRIVATE — USE A PUBLIC PLAYLIST'
  };

  function fail(code) { return { ok: false, error: code, message: ERRORS[code] }; }

  function isValidId(id) {
    return typeof id === 'string' && ID_RE.test(id) && PRIVATE_IDS.indexOf(id) === -1;
  }

  // Link text with no scheme ("youtube.com/playlist?list=...") gets https://; any other scheme is refused.
  function toCandidate(text) {
    if (HTTP_RE.test(text)) return text;
    if (SCHEME_RE.test(text)) return null;
    return 'https://' + text;
  }

  function parse(text) {
    if (typeof text !== 'string') return fail('empty');
    var t = text.trim();
    if (t === '') return fail('empty');
    if (t.length > MAX_INPUT) return fail('tooLong');
    if (UNSAFE_RE.test(t)) return fail('notYoutube');

    var candidate = toCandidate(t);
    if (candidate === null) return fail('notYoutube');
    var u;
    try { u = new URL(candidate); } catch (e) { return fail('notYoutube'); }

    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('notYoutube');
    if (u.username !== '' || u.password !== '' || u.port !== '') return fail('notYoutube');
    if (HOSTS.indexOf(u.hostname) === -1) return fail('notYoutube');

    var id = u.searchParams.get('list');
    if (id === null || id === '') return fail('noList');
    if (PRIVATE_IDS.indexOf(id) !== -1) return fail('private');
    if (!ID_RE.test(id)) return fail('noList');
    return { ok: true, id: id };
  }

  // The only link members are shown, built from a validated ID. Null for anything else.
  function url(id) {
    return isValidId(id) ? 'https://www.youtube.com/playlist?list=' + id : null;
  }

  return { MAX_INPUT: MAX_INPUT, parse: parse, isValidId: isValidId, url: url };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PlaylistLink;
