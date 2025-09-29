{
  description = "Questables development flake (Node + Postgres/PostGIS)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
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

              # Database tooling
              postgresql_17
              postgis

              # Optional helpers
              git
              python3
              jq
              bc
              inkscape
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

          frontend = pkgs.mkShell {
            name = "questables-frontend";
            packages = with pkgs; [
              nodejs_24
              corepack
              tegola
              git
              jq
            ];
            shellHook = ''
              echo "[questables] Frontend shell (node $(node -v))"
            '';
          };

          db = pkgs.mkShell {
            name = "questables-db";
            packages = with pkgs; [
              postgresql_17
              postgis
            ];
            shellHook = ''
              echo "[questables] DB shell (psql $(psql --version | awk '{print $3}'))"
              echo "Tip: initialize a local cluster with:"
              echo "  initdb -D ./pgdata && pg_ctl -D ./pgdata -l ./pg.log start"
              echo "Then create role/db as described in docs/local-postgresql-setup.md"
            '';
          };
        };
      }
    );
}

