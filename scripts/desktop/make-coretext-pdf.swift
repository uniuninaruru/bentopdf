// Renders Japanese text with macOS fonts (Hiragino) into a PDF, like a PDF
// exported from a Mac app. Usage: swift make-coretext-pdf.swift out.pdf
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "jp-coretext.pdf"
var box = CGRect(x: 0, y: 0, width: 595, height: 842)
guard let ctx = CGContext(URL(fileURLWithPath: out) as CFURL, mediaBox: &box, [
  kCGPDFContextTitle as String: "ヒラギノで作成したテスト",
  kCGPDFContextCreator as String: "make-coretext-pdf.swift",
] as CFDictionary) else { fatalError("cannot create PDF") }

let pages: [[String]] = [
  ["ヒラギノ角ゴシックの見出し", "macOS の CoreText で描画した日本語 PDF です。", "縦書きではなく横書き。句読点、「かぎ括弧」、（全角括弧）を含みます。"],
  ["二ページ目", "保存後に再度開いて文字化けしないことを確認します。"],
]
for lines in pages {
  ctx.beginPDFPage(nil)
  let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
  NSGraphicsContext.current = ns
  var y: CGFloat = 760
  for (i, line) in lines.enumerated() {
    let font = NSFont(name: i == 0 ? "HiraginoSans-W6" : "HiraginoSans-W3", size: i == 0 ? 24 : 15)
      ?? NSFont.systemFont(ofSize: 15)
    NSAttributedString(string: line, attributes: [.font: font]).draw(at: CGPoint(x: 56, y: y))
    y -= i == 0 ? 50 : 30
  }
  ctx.endPDFPage()
}
ctx.closePDF()
print("wrote \(out)")
