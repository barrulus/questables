{
  description = "Questables development flake (Node + Postgres/PostGIS)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells = {
          default = pkgs.mkShell {
            name = "questables-dev";
            packages = with pkgs; [
              # Useful Node tooling; project uses npm but these can help
              corepack
              nodejs_24

              # Optional helpers
              git
              jq
              bc
            ];

            # Tips and light DX setup when entering the shell
            shellHook = ''
              echo "[questables] Dev shell ready"
              echo "- node: $(node -v) | npm: $(npm -v)"
              echo "- psql: $(psql --version | awk '{print $3}')"
              echo ""
              echo "Common commands:"
              echo "  npm install        # install deps"
              echo "  npm run dev        # start Vite dev server"
              echo "  npm run db:dev     # start local DB server (Express)"
              echo "  npm run dev:local  # run both frontend + db server"
            '';
          };
        };
      }
    );
}
