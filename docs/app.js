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

  async function loadLatestRelease() {
    const { owner, repo } = inferRepo();

    if (!owner || !repo) {
      throw new Error("Could not infer repository owner and name.");
    }

    const releaseApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const releasesPage = `https://github.com/${owner}/${repo}/releases`;
    const issuesPage = `https://github.com/${owner}/${repo}/issues`;

    releaseNotes.href = releasesPage;
    issuesLink.href = issuesPage;
    repoInfo.textContent = `${owner}/${repo}`;

    const response = await fetch(releaseApi, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const latest = await response.json();
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
    releaseMeta.textContent = `Latest ${latest.tag_name} | ${sizeMb} MB | Published ${published}`;
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
