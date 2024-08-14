import fs from "fs";
import https from "https";
import path from "path";
import tar from "tar-fs";
import gunzip from "gunzip-maybe";

/**
 * A client for the NPM registry API.
 */
export class NpmRegistryClient {

  async getLatestPackageVersion(name: string): Promise<any> {
    const resp = await fetch(
      `https://registry.npmjs.org/${name}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );
    const data = await resp.json();
    return data['dist-tags'].latest;
  }

  // This function isn't used anywhere yet, but would be used to find dependency versions compatible with ^ notation. 
  // ex. The noop3 dependency (^13.7.2) in the is-thirteen package would be resolved to version 13.8.1 instead of 13.7.2.
  // I chose to download the 13.7.2 version specified by is-thirteen for now but noticed npm would download 13.8.1 so
  // I suspect this kind of functionality should be used when downloading dependencies. 
  async getLatestCompatibleVersion(name: string, version: string): Promise<any> {
    const resp = await fetch(
      `https://registry.npmjs.org/${name}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );
    const data = await resp.json();
    const versions = Object.keys(data.versions);
    const majorVersion = version.split(".")[0];
    for (const v of versions.reverse()) {
      if (v.split(".")[0] == majorVersion) {
        return v;
      }
    }
    return "Version Not Found";
  }

  /**
   * Request package information from the NPM registry API as described [here](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md#getpackageversion)
   *
   * @param name The name of the package to be downloaded
   * @param absoluteVersion The absolute (exact) version of the package to be downloaded
   * @returns Information about the package
   */
  async getPackageInfo(name: string, absoluteVersion: string): Promise<any> {
    const resp = await fetch(
      `https://registry.npmjs.org/${name}/${absoluteVersion}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );
    const data = await resp.json();
    return data;
  }

  async downloadTarball(
    name: string,
    absoluteVersion: string,
    downloadToPath: string
  ): Promise<void> {
    const url = `https://registry.npmjs.org/${name}/-/${name}-${absoluteVersion}.tgz`;
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(downloadToPath);

      https
        .get(url, (response) => {
          response.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close();
            resolve(null);
          });
        })
        .on("error", (error) => {
          fileStream.close();
          fs.unlink(downloadToPath, () => {}); // Delete the file if an error occurs
          console.error(
            `Error downloading package ${name}@${absoluteVersion}:`,
            error
          );
          reject(error);
        });
    });

    // Extract the tarball
    const targetDir = path.dirname(downloadToPath);
    const fileStream = fs.createReadStream(downloadToPath);
    fileStream.pipe(gunzip()).pipe(tar.extract(targetDir))
      .on("finish", () => {
        fs.unlinkSync(downloadToPath); // delete tar file
        fs.renameSync(path.join(targetDir, "package"), `${downloadToPath}-${absoluteVersion}`); // rename downloaded package
        console.log(`Downloaded package to ${downloadToPath}-${absoluteVersion}`)
      })
      .on("error",(e) => {
        fileStream.close();
        console.error(`Error extracting package ${name}@${absoluteVersion}:`, e);
        fs.unlinkSync(downloadToPath); // delete tar file if extraction fails
      })
  }
}
