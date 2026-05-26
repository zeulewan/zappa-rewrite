// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ZappaRewriteKit",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "ZappaRewriteKit",
            targets: ["ZappaRewriteKit"]
        )
    ],
    targets: [
        .target(
            name: "ZappaRewriteKit"
        ),
        .testTarget(
            name: "ZappaRewriteKitTests",
            dependencies: ["ZappaRewriteKit"]
        )
    ]
)
