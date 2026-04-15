(function bootstrapLanding() {
  const releaseMeta = document.getElementById("releaseMeta");
  const downloadApk = document.getElementById("downloadApk");
  const releaseNotes = document.getElementById("releaseNotes");
  const issuesLink = document.getElementById("issuesLink");
  const repoInfo = document.getElementById("repoInfo");

  const config = window.HANDKRAFT_RELEASE_CONFIG || {};

  function inferRepo() {
    if (config.owner && config.repo) {
      return { owner: config.owner, repo: config.repo };
    }

    const hostParts = window.location.hostname.split(".");
    const owner = hostParts.length > 0 ? hostParts[0] : "";
    const pathParts = window.location.pathname.split("/").filter(Boolean);

    // Project pages usually resolve to /<repo-name>/
    const repo = pathParts.length > 0 ? pathParts[0] : "HANDKRAFT";

    return { owner, repo };
  }

  function pickApkAsset(assets) {
    return (assets || []).find((asset) => /\.apk$/i.test(asset.name || ""));
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    return { response, data: response.ok ? await response.json() : null };
  }

  async function fetchBestRelease(owner, repo) {
    const latestApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const listApi = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;

    const latest = await fetchJson(latestApi);
    if (latest.response.ok && latest.data) {
      return latest.data;
    }

    // GitHub returns 404 on /releases/latest if only pre-releases exist.
    if (latest.response.status !== 404) {
      throw new Error(`GitHub API returned ${latest.response.status}`);
    }

    const list = await fetchJson(listApi);
    if (!list.response.ok || !Array.isArray(list.data)) {
      throw new Error(`GitHub API returned ${list.response.status}`);
    }

    const published = list.data.filter((release) => !release.draft);
    const withApk = published.find((release) => pickApkAsset(release.assets));

    if (withApk) {
      return withApk;
    }

    if (published.length > 0) {
      return published[0];
    }

    throw new Error("No published releases found.");
  }

  async function loadLatestRelease() {
    const { owner, repo } = inferRepo();

    if (!owner || !repo) {
      throw new Error("Could not infer repository owner and name.");
    }

    const releasesPage = `https://github.com/${owner}/${repo}/releases`;
    const issuesPage = `https://github.com/${owner}/${repo}/issues`;

    releaseNotes.href = releasesPage;
    issuesLink.href = issuesPage;
    repoInfo.textContent = `${owner}/${repo}`;

    const latest = await fetchBestRelease(owner, repo);
    const apk = pickApkAsset(latest.assets);

    if (!apk) {
      downloadApk.textContent = "No APK in latest release";
      downloadApk.href = releasesPage;
      downloadApk.setAttribute("aria-disabled", "false");
      releaseMeta.textContent = `Latest release ${latest.tag_name} does not include an APK asset yet.`;
      return;
    }

    downloadApk.textContent = `Download ${apk.name}`;
    downloadApk.href = apk.browser_download_url;
    downloadApk.setAttribute("aria-disabled", "false");
    releaseNotes.href = latest.html_url || releasesPage;

    const sizeMb = (apk.size / (1024 * 1024)).toFixed(2);
    const published = latest.published_at ? new Date(latest.published_at).toLocaleString() : "Unknown date";
    const label = latest.prerelease ? `Latest pre-release ${latest.tag_name}` : `Latest ${latest.tag_name}`;
    releaseMeta.textContent = `${label} | ${sizeMb} MB | Published ${published}`;
  }

  loadLatestRelease().catch((error) => {
    const { owner, repo } = inferRepo();
    const releasesPage = owner && repo ? `https://github.com/${owner}/${repo}/releases` : "#";

    downloadApk.textContent = "Open Releases";
    downloadApk.href = releasesPage;
    downloadApk.setAttribute("aria-disabled", "false");
    releaseNotes.href = releasesPage;
    releaseMeta.textContent = `Could not load latest release automatically: ${error.message}`;
  });
})();
