module.exports = {
	testEnvironment: "node",
	testMatch: ["**/tests/**/*.test.js"],
	transform: {},
	moduleNameMapper: {
		"\\.(png|jpe?g|gif|svg|webp)$": "<rootDir>/tests/fixtures/fileMock.js",
	},
};
