import Foundation

public enum ZappaPageCapture {
    public static let javaScript = """
    (() => {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('script, style, template, noscript, iframe, canvas, svg, object, embed, video, audio, link, meta').forEach((node) => node.remove());
      clone.querySelectorAll('[hidden], [inert], [aria-hidden="true"]').forEach((node) => node.remove());
      clone.querySelectorAll('img').forEach((image) => {
        const current = image.currentSrc || image.src || image.getAttribute('src') || '';
        if (current) image.setAttribute('src', current);
        ['srcset', 'sizes'].forEach((name) => image.removeAttribute(name));
      });
      clone.querySelectorAll('a[href]').forEach((link) => {
        try {
          link.setAttribute('href', new URL(link.getAttribute('href'), document.baseURI).href);
        } catch (error) {}
      });
      return '<!doctype html>' + clone.outerHTML;
    })();
    """
}

