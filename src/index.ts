import { program } from "commander";
import { NpmRegistryClient } from "./NpmRegistryClient";
import fs from 'fs';
import fsExtra from 'fs-extra';
import { IDependencyMap } from "package-json-type";
import { Queue } from 'queue-typescript';

var registryClient: NpmRegistryClient = new NpmRegistryClient();

// Takes in two version numbers and returns the latest of the two.
function getLatestVersion(v1 : string, v2 : string) : string {
  const [major1, minor1, patch1] = v1.split(".");
  const [major2, minor2, patch2] = v2.split(".");
  [major1, minor1, patch1, major2, minor2, patch2].forEach((x) => Number(x));

  if (major1 > major2) { return v1; }
  if (major1 < major2) { return v2; }
  if (minor1 > minor2) { return v1; }
  if (minor1 < minor2) { return v2; }
  if (patch1 > patch2) { return v1; }
  return v2
}

/**
 * Adds the dependency to the “dependencies” object in package.json
 *
 * Argument <package>: A "name@version" string as defined [here](https://github.com/npm/node-semver#versions)
 */
program
  .command("add <package>")
  .description("Add a package")
  .action(async (pkg) => {
    let [packageName, version] = pkg.split("@");
    if (version === undefined) {
      version = await registryClient.getLatestPackageVersion(packageName)
    }

    // add package to dependencies in output/package.json
    let packageJson = JSON.parse(fs.readFileSync('./output/package.json', 'utf8'));
    packageJson.dependencies[packageName] = version;
    fs.writeFileSync('./output/package.json', JSON.stringify(packageJson, null, 2));
  });

/**
 * Resolves the full dependency list from package.json and downloads all of the required packages to the “node_modules” folder
 *
 * This command has no arguments
 */
program
  .command("install")
  .description("Install dependencies")
  .action(async () => {
    let packageJson = JSON.parse(fs.readFileSync('./output/package.json', 'utf8'));
    let initialDependencies : IDependencyMap = packageJson.dependencies;
    let allDependencies: IDependencyMap = {};

    // initialize list of dependencies to check
    let checkDependencies = new Queue<Array<string>>();
    for (const [packageName, version] of Object.entries(initialDependencies)) {
      checkDependencies.enqueue([packageName, version])
    }

    // go through dependencies
    while (checkDependencies.length != 0) {
      let dep = checkDependencies.dequeue();
      const [packageName, version] = [dep[0], dep[1]];
      // if come across a circular dependency or a dependency with another version, choose the latest dependency version for simplicity
      if (allDependencies[packageName] !== undefined) {
        if (version == allDependencies[packageName]) { continue; } // circular
        let latest = getLatestVersion(version, allDependencies[packageName]);
        console.log(`Dependency conflict for package ${packageName}: Installing version ${latest}`)
        if (version != latest) {
          continue;
        }
      }
      // add dependency to allDependencies 
      allDependencies[packageName] = version;
      // add dependency's dependencies to checkDependencies
      let packageInfo = await registryClient.getPackageInfo(packageName, version);
      let packageDependencies : IDependencyMap = packageInfo.dependencies;
      if (packageDependencies) {
        for (const [n, v] of Object.entries(packageDependencies)) {
          checkDependencies.enqueue([n, v.replace("^", "")])
        }
      }
    }

    // creates output/node_modules folder or clears it if it exists
    fsExtra.ensureDirSync('./output/node_modules/');
    fsExtra.emptyDirSync('./output/node_modules/');

    // download all dependencies to output/node_modules
    for (const [packageName, version] of Object.entries(allDependencies)) {
      await registryClient.downloadTarball(packageName, version, `./output/node_modules/${packageName}`);
    }
  });

program.parse(process.argv);
