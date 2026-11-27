// Webpack 4 hashes with md4, which newer Node versions (17+) no longer ship.
// Map it to sha256 so the build works on both old and current Node.
const crypto = require("crypto");
const originalCreateHash = crypto.createHash;
crypto.createHash = (algorithm, ...rest) =>
  originalCreateHash(algorithm === "md4" ? "sha256" : algorithm, ...rest);

module.exports = {
  devtool: "none",
  entry: "./src/index.js",
  module: {
    rules: [
      {
        test: /\.html$/i,
        loader: 'html-loader',
      },
      {
        test: /\.(svg|png|jpg|gif|patt)$/,
        use: {
          // The file-loader resolves import/require() on a file into a url and emits the file into the output directory.
          loader: "file-loader",
          options: {
            name: "[name].[hash].[ext]",
            outputPath: "imgs"
          }
        }
      },
      {
        test: /\.css$/i,
        use: ['file-loader'],
      },
    ]
  }
}