const DEFAULT_URL = "https://gregory-at-choice.github.io/operations01-web/";
chrome.storage.sync.get({ appUrl: DEFAULT_URL }, (v) => { document.getElementById("url").value = v.appUrl || DEFAULT_URL; });
document.getElementById("save").onclick = () => {
  const url = document.getElementById("url").value.trim() || DEFAULT_URL;
  chrome.storage.sync.set({ appUrl: url }, () => { document.getElementById("ok").textContent = "Enregistré."; });
};
