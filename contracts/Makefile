# Makefile for Acredia Soroban Smart Contracts
# Prerequisites: cargo, stellar-cli/soroban-cli installed

CONTRACT_NAME := acredia-credential
WASM_PATH := target/wasm32v1-none/release/acredia_stellar.wasm
TESTNET_NETWORK := testnet
MAINNET_NETWORK := mainnet

.PHONY: all build test test-auth deploy-testnet deploy-mainnet clean format bindings setup

all: build

# Install rust target if not exists
setup:
	rustup target add wasm32v1-none

# Format the Rust code
format:
	cargo fmt

# Build the smart contract and optimize for WASM
build: setup
	cargo build --target wasm32v1-none --release
	stellar contract optimize --wasm $(WASM_PATH)
	@echo "Build successful! Optimized WASM located at $(WASM_PATH)"

# Run tests
test:
	cargo test

# Deploy to testnet using a testnet account
deploy-testnet: build
	@echo "Deploying to Testnet..."
	# Ensure you have set up a stellar CLI identity first: stellar keys generate test-deployer --network testnet
	stellar contract deploy \
		--wasm $(WASM_PATH) \
		--network $(TESTNET_NETWORK) \
		--source test-deployer

# Deploy to mainnet using a real account
deploy-mainnet: build
	@echo "Deploying to Mainnet..."
	stellar contract deploy \
		--wasm $(WASM_PATH) \
		--network $(MAINNET_NETWORK) \
		--source mainnet-deployer

# Clean build artifacts
clean:
	cargo clean

# Generate Typescript bindings (optional)
bindings: build
	stellar contract bindings typescript --wasm $(WASM_PATH) --id $(CONTRACT_ID) --network $(TESTNET_NETWORK) --output-dir ../frontend/src/contracts
