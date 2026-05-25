import unittest

from zappa_core import build_error_body
from zappa_core import detect_asset_kind
from zappa_core import sanitize_rewritten_asset


class DetectAssetKindTests(unittest.TestCase):
    def test_detects_html_from_content_type(self) -> None:
        self.assertEqual(detect_asset_kind("text/html; charset=utf-8", "/index"), "html")

    def test_detects_css_from_extension(self) -> None:
        self.assertEqual(detect_asset_kind("application/octet-stream", "/site.css"), "css")

    def test_detects_javascript_from_content_type(self) -> None:
        self.assertEqual(detect_asset_kind("application/javascript", "/bundle"), "javascript")


class SanitizeRewrittenAssetTests(unittest.TestCase):
    def test_removes_integrity_attributes_from_html(self) -> None:
        source = '<script src="/app.js" integrity="sha384-abc" crossorigin="anonymous"></script>'
        expected = '<script src="/app.js" crossorigin="anonymous"></script>'
        self.assertEqual(sanitize_rewritten_asset("html", source), expected)

    def test_leaves_non_html_unchanged(self) -> None:
        self.assertEqual(sanitize_rewritten_asset("css", "body{color:red}"), "body{color:red}")


class BuildErrorBodyTests(unittest.TestCase):
    def test_javascript_error_throws(self) -> None:
        body = build_error_body("javascript", "bad upstream")
        self.assertIn("throw new Error", body)
        self.assertIn("bad upstream", body)


if __name__ == "__main__":
    unittest.main()
