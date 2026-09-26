'use strict';

// Only recognised Facebook video permalinks are eligible for a player.
// Ordinary posts, profiles and groups retain their regular Open Graph cards.
(function (scope) {
  const getFacebookVideoEmbedUrl = (value) => {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch {
      return '';
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const hostname = url.hostname.toLowerCase();
    if (!['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(hostname)) {
      return '';
    }

    const path = url.pathname.toLowerCase();
    const segments = path.split('/').filter(Boolean);
    const isVideoPath = (
      // /page/videos/ID, /videos/ID, /reel/ID and /share/v/ID
      (segments.includes('videos') && segments.length > segments.indexOf('videos') + 1)
      || (['reel', 'reels'].includes(segments[0]) && segments.length === 2)
      || (segments[0] === 'share' && ['v', 'r'].includes(segments[1]) && segments.length === 3)
      || ((path === '/watch/' || path === '/watch' || path === '/video.php'
        || path === '/watch/live/' || path === '/watch/live')
        && Boolean(url.searchParams.get('v')))
    );
    if (!isVideoPath) return '';

    const player = new URL('https://www.facebook.com/plugins/video.php');
    player.searchParams.set('href', url.toString());
    player.searchParams.set('show_text', 'false');
    player.searchParams.set('width', '480');
    player.searchParams.set('autoplay', 'false');
    return player.toString();
  };

  const api = { getFacebookVideoEmbedUrl };
  if (scope) scope.dizychatFacebookVideo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null);
