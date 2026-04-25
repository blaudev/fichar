const FIELDS = [
  "loginUrl",
  "user",
  "pass",
  "userSelector",
  "passSelector",
  "submitSelector",
  "clockInSelector",
  "clockInConfirmSelector",
  "pauseSelector",
  "pauseConfirmSelector",
  "resumeSelector",
  "resumeConfirmSelector",
  "clockOutSelector",
  "clockOutConfirmSelector",
  "reopenSelector",
  "postActionWait",
];

const DEFAULTS = {
  loginUrl: "https://presence.addingplus.net/default.aspx",
  userSelector: 'input[name="username"]',
  passSelector: 'input[name="pwd"]',
  submitSelector: 'button[id="btnEntrar"]',
  clockInSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnIniciar",
  clockInConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnIniciar",
  pauseSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnParar",
  pauseConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnParar",
  resumeSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReanudar",
  resumeConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnReanudar",
  clockOutSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnFinalizar",
  clockOutConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnFinalizar",
  reopenSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReabrir",
  postActionWait: 3000,
};

async function load() {
  const { config } = await chrome.storage.local.get("config");
  const merged = { ...DEFAULTS, ...config };
  for (const field of FIELDS) {
    const el = document.getElementById(field);
    if (el && merged[field] !== undefined) {
      el.value = merged[field];
    }
  }
}

document.getElementById("btnSave").addEventListener("click", async () => {
  const config = {};
  for (const field of FIELDS) {
    const el = document.getElementById(field);
    if (el) {
      config[field] = field === "postActionWait" ? Number(el.value) : el.value;
    }
  }
  await chrome.storage.local.set({ config });
  const saved = document.getElementById("saved");
  saved.style.display = "inline";
  setTimeout(() => {
    saved.style.display = "none";
  }, 2000);
});

load();
