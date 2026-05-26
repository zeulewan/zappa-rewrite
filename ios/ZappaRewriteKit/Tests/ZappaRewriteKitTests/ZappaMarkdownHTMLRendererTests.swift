import XCTest
@testable import ZappaRewriteKit

final class ZappaMarkdownHTMLRendererTests: XCTestCase {
    func testRendersRawFigureBlockAsHTML() {
        let html = ZappaMarkdownHTMLRenderer.renderFragment("""
        # Story

        <figure><img src="https://example.com/photo.jpg" alt="Photo" width="465" height="310" /><figcaption>Caption</figcaption></figure>
        """)

        XCTAssertTrue(html.contains("<figure><img src=\"https://example.com/photo.jpg\""))
        XCTAssertTrue(html.contains("width=\"465\""))
        XCTAssertTrue(html.contains("<figcaption>Caption</figcaption>"))
        XCTAssertFalse(html.contains("&lt;figure"))
    }

    func testRendersEscapedFigureBlockAsHTML() {
        let html = ZappaMarkdownHTMLRenderer.renderFragment("""
        &lt;figure&gt;&lt;img src=&quot;https://example.com/photo.jpg&quot; alt=&quot;Photo&quot; width=&quot;465&quot; /&gt;&lt;/figure&gt;
        """)

        XCTAssertTrue(html.contains("<figure><img src=\"https://example.com/photo.jpg\""))
        XCTAssertTrue(html.contains("alt=\"Photo\""))
        XCTAssertFalse(html.contains("&lt;img"))
    }

    func testRendersFencedHTMLFigureAsHTML() {
        let html = ZappaMarkdownHTMLRenderer.renderFragment("""
        ```html
        <figure><img src="https://example.com/fenced.jpg" alt="Fenced" width="465" /></figure>
        ```
        """)

        XCTAssertTrue(html.contains("<figure><img src=\"https://example.com/fenced.jpg\""))
        XCTAssertFalse(html.contains("<pre><code>"))
    }

    func testRendersInlineFigureAsHTMLFragment() {
        let html = ZappaMarkdownHTMLRenderer.renderFragment("""
        Inline media: <figure><img src="https://example.com/inline.jpg" alt="Inline" width="465" /></figure>
        """)

        XCTAssertTrue(html.contains("Inline media:"))
        XCTAssertTrue(html.contains("<figure><img src=\"https://example.com/inline.jpg\""))
        XCTAssertFalse(html.contains("&lt;figure"))
    }

    func testSanitizesRawFigureHTML() {
        let html = ZappaMarkdownHTMLRenderer.renderFragment("""
        <figure onclick="bad()"><img src="javascript:alert(1)" onerror="bad()" style="display:block" width="100%" /><script>alert(1)</script><figcaption>Caption</figcaption></figure>
        """)

        XCTAssertTrue(html.contains("<figure>"))
        XCTAssertTrue(html.contains("<img"))
        XCTAssertTrue(html.contains("<figcaption>Caption</figcaption>"))
        XCTAssertFalse(html.contains("onclick"))
        XCTAssertFalse(html.contains("onerror"))
        XCTAssertFalse(html.contains("javascript:"))
        XCTAssertFalse(html.contains("style="))
        XCTAssertFalse(html.contains("<script"))
        XCTAssertFalse(html.contains("width=\"100%\""))
    }
}
