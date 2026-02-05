// ReviewPing - Options Page Script

// 기본 템플릿
const DEFAULT_TEMPLATES = {
  request: `🔍 *리뷰 요청*
<{pr_url}|{pr_title}>
{reviewers} 리뷰 부탁드립니다! 🙏`,
  complete: `✅ *리뷰 완료*
<{pr_url}|{pr_title}>
{author} 리뷰 완료했습니다!`,
  merge: `🎉 *머지 완료*
<{pr_url}|{pr_title}>
{repo}에 머지되었습니다!`
};

// DOM 요소
const elements = {
  // 탭 관련
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabBot: document.getElementById('tab-bot'),
  tabWebhook: document.getElementById('tab-webhook'),
  // Bot Token 관련
  botToken: document.getElementById('botToken'),
  toggleBotToken: document.getElementById('toggleBotToken'),
  botTokenHelp: document.getElementById('botTokenHelp'),
  botTokenImported: document.getElementById('botTokenImported'),
  resetBotToken: document.getElementById('resetBotToken'),
  channelId: document.getElementById('channelId'),
  parseChannelId: document.getElementById('parseChannelId'),
  testConnection: document.getElementById('testConnection'),
  testResult: document.getElementById('testResult'),
  // Webhook 관련
  webhookUrl: document.getElementById('webhookUrl'),
  toggleWebhookUrl: document.getElementById('toggleWebhookUrl'),
  testWebhook: document.getElementById('testWebhook'),
  testWebhookResult: document.getElementById('testWebhookResult'),
  // 채널 매핑 관련
  channelMappingList: document.getElementById('channelMappingList'),
  channelMappingValueHeader: document.getElementById('channelMappingValueHeader'),
  addChannelMapping: document.getElementById('addChannelMapping'),
  // GitHub 관련
  autoAddReviewers: document.getElementById('autoAddReviewers'),
  githubToken: document.getElementById('githubToken'),
  toggleGithubToken: document.getElementById('toggleGithubToken'),
  // 템플릿 관련
  requestTemplate: document.getElementById('requestTemplate'),
  completeTemplate: document.getElementById('completeTemplate'),
  mergeTemplate: document.getElementById('mergeTemplate'),
  mergeNotificationEnabled: document.getElementById('mergeNotificationEnabled'),
  resetTemplates: document.getElementById('resetTemplates'),
  // 허용 저장소 관련
  allowedReposList: document.getElementById('allowedReposList'),
  addAllowedRepo: document.getElementById('addAllowedRepo'),
  // 사용자 매핑 관련
  mappingList: document.getElementById('mappingList'),
  addMapping: document.getElementById('addMapping'),
  saveSettings: document.getElementById('saveSettings'),
  saveResult: document.getElementById('saveResult'),
  // 공유 관련
  includeToken: document.getElementById('includeToken'),
  exportSettings: document.getElementById('exportSettings'),
  exportResult: document.getElementById('exportResult'),
  importData: document.getElementById('importData'),
  importSettings: document.getElementById('importSettings'),
  importResult: document.getElementById('importResult')
};

// 현재 연결 방식 (bot 또는 webhook)
let currentConnectionType = 'bot';

// 탭 전환 함수
function switchTab(tabName) {
  currentConnectionType = tabName;

  // 탭 버튼 활성화 상태 변경
  elements.tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 탭 컨텐츠 표시/숨김
  if (tabName === 'bot') {
    elements.tabBot.classList.add('active');
    elements.tabWebhook.classList.remove('active');
    elements.channelMappingValueHeader.textContent = '채널 ID';
  } else {
    elements.tabBot.classList.remove('active');
    elements.tabWebhook.classList.add('active');
    elements.channelMappingValueHeader.textContent = 'Webhook URL';
  }

  // 채널 매핑 입력 필드 placeholder 업데이트
  updateChannelMappingPlaceholders();
}

// 채널 매핑 placeholder 업데이트
function updateChannelMappingPlaceholders() {
  const inputs = elements.channelMappingList.querySelectorAll('.channel-mapping-value');
  const placeholder = currentConnectionType === 'bot' ? 'C01ABCD2EFG' : 'https://hooks.slack.com/services/...';
  inputs.forEach(input => {
    input.placeholder = placeholder;
  });
}

// 탭 버튼 이벤트 리스너
elements.tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// Slack 채널 링크에서 Channel ID 추출
function parseSlackChannelId(input) {
  if (!input) return '';

  const trimmed = input.trim();

  // 이미 Channel ID 형태인 경우 (C로 시작하는 영문숫자)
  if (/^C[A-Z0-9]+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // Slack 채널 링크에서 추출
  // https://app.slack.com/client/T01ABCD2EFG/C01ABCD2EFG
  // https://workspace.slack.com/archives/C01ABCD2EFG
  const patterns = [
    /slack\.com\/client\/[A-Z0-9]+\/(C[A-Z0-9]+)/i,
    /slack\.com\/archives\/(C[A-Z0-9]+)/i,
    /(C[A-Z0-9]{8,})/i  // 일반적인 C로 시작하는 ID 패턴
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  // 그 외의 경우 원본 반환
  return trimmed;
}

// GitHub URL에서 owner/repo 추출
function parseGitHubRepo(input) {
  if (!input) return '';

  const trimmed = input.trim();

  // 이미 owner/repo 또는 owner/* 형태인 경우
  if (/^[a-zA-Z0-9_.-]+\/(\*|[a-zA-Z0-9_.-]+)$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // GitHub URL에서 추출
  // https://github.com/owner/repo/pull/123
  // https://github.com/owner/repo
  const urlMatch = trimmed.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
  if (urlMatch) {
    return `${urlMatch[1]}/${urlMatch[2]}`.toLowerCase();
  }

  // 그 외의 경우 원본 반환
  return trimmed.toLowerCase();
}

// 허용 저장소 행 생성
function createAllowedRepoRow(repo = '') {
  const row = document.createElement('div');
  row.className = 'allowed-repo-row';
  row.innerHTML = `
    <input type="text" class="allowed-repo-input" placeholder="owner/repo 또는 owner/*" value="${repo}">
    <button type="button" class="btn btn-danger remove-repo">✕</button>
  `;

  const input = row.querySelector('.allowed-repo-input');

  // 붙여넣기 또는 입력 시 자동 파싱
  input.addEventListener('input', (e) => {
    const parsed = parseGitHubRepo(e.target.value);
    if (parsed !== e.target.value.trim().toLowerCase() && parsed.includes('/')) {
      e.target.value = parsed;
      e.target.classList.add('auto-parsed');
      setTimeout(() => e.target.classList.remove('auto-parsed'), 1500);
    }
  });

  // 붙여넣기 이벤트
  input.addEventListener('paste', (e) => {
    setTimeout(() => {
      const parsed = parseGitHubRepo(input.value);
      if (parsed !== input.value.trim().toLowerCase() && parsed.includes('/')) {
        input.value = parsed;
        input.classList.add('auto-parsed');
        setTimeout(() => input.classList.remove('auto-parsed'), 1500);
      }
    }, 0);
  });

  row.querySelector('.remove-repo').addEventListener('click', () => {
    row.remove();
  });

  return row;
}

// 허용 저장소 목록 렌더링
function renderAllowedRepos(repos) {
  elements.allowedReposList.innerHTML = '';

  if (repos && repos.length > 0) {
    repos.forEach(repo => {
      elements.allowedReposList.appendChild(createAllowedRepoRow(repo));
    });
  }
}

// 허용 저장소 데이터 수집
function collectAllowedRepos() {
  const rows = elements.allowedReposList.querySelectorAll('.allowed-repo-row');
  const repos = [];

  rows.forEach(row => {
    const repo = row.querySelector('.allowed-repo-input').value.trim().toLowerCase();
    if (repo) {
      repos.push(repo);
    }
  });

  return repos;
}

// 채널 매핑 행 생성
function createChannelMappingRow(repo = '', channelId = '', webhookUrl = '') {
  const row = document.createElement('div');
  row.className = 'mapping-row channel-mapping-row';

  const placeholder = currentConnectionType === 'bot' ? 'C01ABCD2EFG' : 'https://hooks.slack.com/services/...';
  const value = currentConnectionType === 'bot' ? channelId : webhookUrl;

  row.innerHTML = `
    <input type="text" class="channel-mapping-repo" placeholder="owner/repo 또는 owner/*" value="${repo}">
    <input type="text" class="channel-mapping-value" placeholder="${placeholder}" value="${value}">
    <button type="button" class="btn btn-danger remove-channel-mapping">✕</button>
  `;

  // 저장소 입력 자동 파싱
  const repoInput = row.querySelector('.channel-mapping-repo');
  repoInput.addEventListener('paste', (e) => {
    setTimeout(() => {
      const parsed = parseGitHubRepo(repoInput.value);
      if (parsed !== repoInput.value.trim().toLowerCase() && parsed.includes('/')) {
        repoInput.value = parsed;
        repoInput.classList.add('auto-parsed');
        setTimeout(() => repoInput.classList.remove('auto-parsed'), 1500);
      }
    }, 0);
  });

  // 채널 ID 자동 파싱 (Bot Token 모드일 때)
  const valueInput = row.querySelector('.channel-mapping-value');
  valueInput.addEventListener('paste', (e) => {
    setTimeout(() => {
      if (currentConnectionType === 'bot') {
        const parsed = parseSlackChannelId(valueInput.value);
        if (parsed !== valueInput.value.trim() && parsed.startsWith('C')) {
          valueInput.value = parsed;
          valueInput.classList.add('auto-parsed');
          setTimeout(() => valueInput.classList.remove('auto-parsed'), 1500);
        }
      }
    }, 0);
  });

  row.querySelector('.remove-channel-mapping').addEventListener('click', () => {
    row.remove();
  });

  return row;
}

// 채널 매핑 목록 렌더링
function renderChannelMappings(mappings) {
  elements.channelMappingList.innerHTML = '';

  if (mappings && mappings.length > 0) {
    mappings.forEach(({ repo, channelId, webhookUrl }) => {
      elements.channelMappingList.appendChild(createChannelMappingRow(repo, channelId || '', webhookUrl || ''));
    });
  }
}

// 채널 매핑 데이터 수집
function collectChannelMappings() {
  const rows = elements.channelMappingList.querySelectorAll('.channel-mapping-row');
  const mappings = [];

  rows.forEach(row => {
    const repo = row.querySelector('.channel-mapping-repo').value.trim().toLowerCase();
    const value = row.querySelector('.channel-mapping-value').value.trim();

    if (repo && value) {
      const mapping = { repo };
      if (currentConnectionType === 'bot') {
        mapping.channelId = value;
      } else {
        mapping.webhookUrl = value;
      }
      mappings.push(mapping);
    }
  });

  return mappings;
}

// 로컬 백업 키
const BACKUP_KEY = 'reviewping_settings_backup';

// 로컬 백업 저장
function saveLocalBackup(settings) {
  try {
    const backup = {
      ...settings,
      _backupTime: new Date().toISOString()
    };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    console.log('[ReviewPing] 로컬 백업 저장됨:', backup._backupTime);
  } catch (e) {
    console.error('[ReviewPing] 로컬 백업 실패:', e);
  }
}

// 로컬 백업 불러오기
function loadLocalBackup() {
  try {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (backup) {
      return JSON.parse(backup);
    }
  } catch (e) {
    console.error('[ReviewPing] 로컬 백업 로드 실패:', e);
  }
  return null;
}

// 설정 불러오기
async function loadSettings() {
  let settings = await chrome.storage.sync.get({
    connectionType: 'bot',
    botToken: '',
    channelId: '',
    webhookUrl: '',
    channelMappings: [],
    autoAddReviewers: true,
    githubToken: '',
    requestTemplate: DEFAULT_TEMPLATES.request,
    completeTemplate: DEFAULT_TEMPLATES.complete,
    mergeTemplate: DEFAULT_TEMPLATES.merge,
    mergeNotificationEnabled: true,
    userMappings: [],
    allowedRepos: [],
    tokenFromImport: false
  });

  // 설정이 비어있으면 로컬 백업에서 복원 시도
  const hasSettings = settings.botToken || settings.channelId || settings.webhookUrl || settings.userMappings.length > 0;

  if (!hasSettings) {
    const backup = loadLocalBackup();
    if (backup && (backup.botToken || backup.channelId || backup.userMappings?.length > 0)) {
      console.log('[ReviewPing] 로컬 백업에서 설정 복원 중...');

      // 백업 메타데이터 제거
      const { _backupTime, ...restoredSettings } = backup;

      // chrome.storage.sync에 복원
      await chrome.storage.sync.set(restoredSettings);
      settings = restoredSettings;

      showSaveResult(`백업에서 복원됨 (${new Date(_backupTime).toLocaleString()})`, true);
    }
  }

  // 가져오기로 설정된 토큰인 경우 마스킹 처리
  if (settings.tokenFromImport && settings.botToken) {
    elements.botToken.value = '';
    elements.botToken.disabled = true;
    elements.botToken.dataset.imported = 'true';
    elements.toggleBotToken.style.display = 'none';
    elements.botTokenHelp.style.display = 'none';
    elements.botTokenImported.style.display = 'block';
  } else {
    elements.botToken.value = settings.botToken || '';
    elements.botToken.disabled = false;
    elements.botToken.dataset.imported = 'false';
    elements.toggleBotToken.style.display = 'flex';
    elements.botTokenHelp.style.display = 'block';
    elements.botTokenImported.style.display = 'none';
  }

  elements.channelId.value = settings.channelId || '';
  elements.webhookUrl.value = settings.webhookUrl || '';
  elements.autoAddReviewers.checked = settings.autoAddReviewers !== false;
  elements.githubToken.value = settings.githubToken || '';
  elements.requestTemplate.value = settings.requestTemplate || DEFAULT_TEMPLATES.request;
  elements.completeTemplate.value = settings.completeTemplate || DEFAULT_TEMPLATES.complete;
  elements.mergeTemplate.value = settings.mergeTemplate || DEFAULT_TEMPLATES.merge;
  elements.mergeNotificationEnabled.checked = settings.mergeNotificationEnabled !== false;

  // 연결 방식에 따라 탭 전환
  if (settings.connectionType === 'webhook') {
    switchTab('webhook');
  } else {
    switchTab('bot');
  }

  // 허용 저장소 렌더링
  renderAllowedRepos(settings.allowedRepos || []);

  // 사용자 매핑 렌더링
  renderMappings(settings.userMappings || []);

  // 채널 매핑 렌더링
  renderChannelMappings(settings.channelMappings || []);
}

// Slack 프로필 링크에서 User ID 추출
function parseSlackUserId(input) {
  if (!input) return '';

  const trimmed = input.trim();

  // 이미 User ID 형태인 경우 (U로 시작하는 영문숫자)
  if (/^U[A-Z0-9]+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // Slack 프로필 링크에서 추출
  // https://app.slack.com/team/U01ABCD2EFG
  // https://workspace.slack.com/team/U01ABCD2EFG
  const linkMatch = trimmed.match(/slack\.com\/team\/(U[A-Z0-9]+)/i);
  if (linkMatch) {
    return linkMatch[1].toUpperCase();
  }

  // 그 외의 경우 원본 반환
  return trimmed;
}

// 매핑 행 생성
function createMappingRow(github = '', slack = '') {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.innerHTML = `
    <input type="text" class="github-username" placeholder="github-username" value="${github}">
    <input type="text" class="slack-userid" placeholder="U01ABCD2EFG 또는 프로필 링크" value="${slack}">
    <button type="button" class="btn btn-danger remove-mapping">✕</button>
  `;

  const slackInput = row.querySelector('.slack-userid');

  // 붙여넣기 또는 입력 시 자동 파싱
  slackInput.addEventListener('input', (e) => {
    const parsed = parseSlackUserId(e.target.value);
    if (parsed !== e.target.value.trim() && parsed.startsWith('U')) {
      // 링크에서 ID를 추출한 경우
      e.target.value = parsed;
      e.target.classList.add('auto-parsed');
      setTimeout(() => e.target.classList.remove('auto-parsed'), 1500);
    }
  });

  // 붙여넣기 이벤트 (더 빠른 반응)
  slackInput.addEventListener('paste', (e) => {
    setTimeout(() => {
      const parsed = parseSlackUserId(slackInput.value);
      if (parsed !== slackInput.value.trim() && parsed.startsWith('U')) {
        slackInput.value = parsed;
        slackInput.classList.add('auto-parsed');
        setTimeout(() => slackInput.classList.remove('auto-parsed'), 1500);
      }
    }, 0);
  });

  row.querySelector('.remove-mapping').addEventListener('click', () => {
    row.remove();
  });

  return row;
}

// 매핑 목록 렌더링
function renderMappings(mappings) {
  elements.mappingList.innerHTML = '';

  if (mappings.length === 0) {
    elements.mappingList.appendChild(createMappingRow());
  } else {
    mappings.forEach(({ github, slack }) => {
      elements.mappingList.appendChild(createMappingRow(github, slack));
    });
  }
}

// 매핑 데이터 수집
function collectMappings() {
  const rows = elements.mappingList.querySelectorAll('.mapping-row');
  const mappings = [];

  rows.forEach(row => {
    const github = row.querySelector('.github-username').value.trim();
    const slack = row.querySelector('.slack-userid').value.trim();

    if (github && slack) {
      mappings.push({ github, slack });
    }
  });

  return mappings;
}

// 연결 테스트
async function testConnection() {
  let botToken = elements.botToken.value.trim();
  const channelId = elements.channelId.value.trim();

  // 가져오기한 토큰인 경우 storage에서 가져오기
  if (!botToken && elements.botToken.dataset.imported === 'true') {
    const settings = await chrome.storage.sync.get(['botToken']);
    botToken = settings.botToken || '';
  }

  if (!botToken || !channelId) {
    showTestResult('Bot Token과 채널 ID를 입력하세요', false);
    return;
  }

  elements.testConnection.disabled = true;
  elements.testResult.textContent = '테스트 중...';
  elements.testResult.className = 'test-result';

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: channelId,
        text: '✅ ReviewPing 연결 테스트 성공!'
      })
    });

    const data = await response.json();

    if (data.ok) {
      showTestResult('연결 성공! 채널을 확인하세요', true);
    } else {
      showTestResult(`실패: ${data.error}`, false);
    }
  } catch (error) {
    showTestResult(`오류: ${error.message}`, false);
  } finally {
    elements.testConnection.disabled = false;
  }
}

// 테스트 결과 표시
function showTestResult(message, success) {
  elements.testResult.textContent = message;
  elements.testResult.className = `test-result ${success ? 'success' : 'error'}`;
}

// Webhook 연결 테스트
async function testWebhookConnection() {
  const webhookUrl = elements.webhookUrl.value.trim();

  if (!webhookUrl) {
    showWebhookTestResult('Webhook URL을 입력하세요', false);
    return;
  }

  if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
    showWebhookTestResult('올바른 Slack Webhook URL이 아닙니다', false);
    return;
  }

  elements.testWebhook.disabled = true;
  elements.testWebhookResult.textContent = '테스트 중...';
  elements.testWebhookResult.className = 'test-result';

  // Background script를 통해 테스트 (CORS 우회)
  chrome.runtime.sendMessage({
    type: 'TEST_WEBHOOK',
    payload: { webhookUrl }
  }, (response) => {
    elements.testWebhook.disabled = false;

    if (response && response.success) {
      showWebhookTestResult('연결 성공! 채널을 확인하세요', true);
    } else {
      showWebhookTestResult(`오류: ${response?.error || '연결 실패'}`, false);
    }
  });
}

// Webhook 테스트 결과 표시
function showWebhookTestResult(message, success) {
  elements.testWebhookResult.textContent = message;
  elements.testWebhookResult.className = `test-result ${success ? 'success' : 'error'}`;
}

// Webhook URL 보기/숨기기 토글
function toggleWebhookUrlVisibility() {
  const input = elements.webhookUrl;
  const button = elements.toggleWebhookUrl;
  const iconEye = button.querySelector('.icon-eye');
  const iconEyeOff = button.querySelector('.icon-eye-off');

  if (input.type === 'password') {
    input.type = 'text';
    iconEye.style.display = 'none';
    iconEyeOff.style.display = 'block';
  } else {
    input.type = 'password';
    iconEye.style.display = 'block';
    iconEyeOff.style.display = 'none';
  }
}

// 설정 저장
async function saveSettings() {
  const newTokenValue = elements.botToken.value.trim();
  const isImportedToken = elements.botToken.dataset.imported === 'true';

  // 기존 설정 가져오기 (가져온 토큰 유지를 위해)
  const existingSettings = await chrome.storage.sync.get(['botToken', 'tokenFromImport']);

  let botToken = newTokenValue;
  let tokenFromImport = false;

  // 사용자가 새 토큰을 입력하지 않고, 가져온 토큰이 있는 경우 유지
  if (!newTokenValue && isImportedToken && existingSettings.botToken) {
    botToken = existingSettings.botToken;
    tokenFromImport = true;
  }

  const settings = {
    connectionType: currentConnectionType,
    botToken,
    tokenFromImport,
    channelId: elements.channelId.value.trim(),
    webhookUrl: elements.webhookUrl.value.trim(),
    channelMappings: collectChannelMappings(),
    autoAddReviewers: elements.autoAddReviewers.checked,
    githubToken: elements.githubToken.value.trim(),
    requestTemplate: elements.requestTemplate.value || DEFAULT_TEMPLATES.request,
    completeTemplate: elements.completeTemplate.value || DEFAULT_TEMPLATES.complete,
    mergeTemplate: elements.mergeTemplate.value || DEFAULT_TEMPLATES.merge,
    mergeNotificationEnabled: elements.mergeNotificationEnabled.checked,
    allowedRepos: collectAllowedRepos(),
    userMappings: collectMappings()
  };

  try {
    // chrome.storage.sync에 저장
    await chrome.storage.sync.set(settings);

    // 로컬 백업도 저장 (업데이트 시 복원용)
    saveLocalBackup(settings);

    showSaveResult('저장 완료!', true);
  } catch (error) {
    showSaveResult(`저장 실패: ${error.message}`, false);
  }
}

// 저장 결과 표시
function showSaveResult(message, success) {
  elements.saveResult.textContent = message;
  elements.saveResult.className = `save-result ${success ? 'success' : 'error'}`;

  setTimeout(() => {
    elements.saveResult.textContent = '';
  }, 3000);
}

// 템플릿 초기화
function resetTemplates() {
  elements.requestTemplate.value = DEFAULT_TEMPLATES.request;
  elements.completeTemplate.value = DEFAULT_TEMPLATES.complete;
  elements.mergeTemplate.value = DEFAULT_TEMPLATES.merge;
}

// 채널 ID 파싱 버튼 핸들러
function handleParseChannelId() {
  const input = elements.channelId.value;
  const parsed = parseSlackChannelId(input);

  if (parsed !== input.trim() && parsed.startsWith('C')) {
    elements.channelId.value = parsed;
    elements.channelId.classList.add('input-parsed');
    setTimeout(() => elements.channelId.classList.remove('input-parsed'), 1500);
  } else if (parsed.startsWith('C')) {
    // 이미 올바른 형태
    elements.channelId.classList.add('input-parsed');
    setTimeout(() => elements.channelId.classList.remove('input-parsed'), 1500);
  }
}

// AES-GCM 암호화 설정
const CRYPTO_CONFIG = {
  // 고정 키 (ReviewPing 확장 프로그램 전용)
  SECRET_KEY: 'ReviewPing_2024_SecretKey_!@#$',
  ALGORITHM: 'AES-GCM',
  PREFIX: 'RP2:'  // 버전 2 (암호화)
};

// 문자열을 CryptoKey로 변환
async function getEncryptionKey() {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(CRYPTO_CONFIG.SECRET_KEY);

  // SHA-256으로 해시하여 32바이트 키 생성
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);

  return await crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: CRYPTO_CONFIG.ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );
}

// Uint8Array를 Base64로 변환 (안전한 방식)
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64를 Uint8Array로 변환 (안전한 방식)
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// AES-GCM 암호화
async function encodeSettings(obj) {
  const jsonString = JSON.stringify(obj);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);

  // 랜덤 IV 생성 (12바이트)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await getEncryptionKey();

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: CRYPTO_CONFIG.ALGORITHM, iv: iv },
    key,
    data
  );

  // IV + 암호문을 합치기
  const encryptedArray = new Uint8Array(encryptedBuffer);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);

  // 안전한 Base64 인코딩
  const base64 = arrayBufferToBase64(combined);
  return CRYPTO_CONFIG.PREFIX + base64;
}

// AES-GCM 복호화
async function decodeSettings(encoded) {
  // 공백 및 줄바꿈 제거
  const cleanEncoded = encoded.trim().replace(/\s/g, '');

  console.log('[ReviewPing] 디코딩 시도:', cleanEncoded.substring(0, 50) + '...');
  console.log('[ReviewPing] 접두어 확인:', cleanEncoded.substring(0, 4));

  // 접두어 확인
  if (!cleanEncoded.startsWith(CRYPTO_CONFIG.PREFIX)) {
    // 이전 버전(RP1:) 호환성
    if (cleanEncoded.startsWith('RP1:')) {
      return decodeSettingsLegacy(cleanEncoded);
    }
    console.error('[ReviewPing] 예상 접두어:', CRYPTO_CONFIG.PREFIX, '실제:', cleanEncoded.substring(0, 4));
    throw new Error('올바른 ReviewPing 설정 코드가 아닙니다');
  }

  const base64 = cleanEncoded.slice(CRYPTO_CONFIG.PREFIX.length);

  // 안전한 Base64 디코딩
  const combined = base64ToArrayBuffer(base64);

  // IV와 암호문 분리
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);

  const key = await getEncryptionKey();

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: CRYPTO_CONFIG.ALGORITHM, iv: iv },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  const jsonString = decoder.decode(decryptedBuffer);
  return JSON.parse(jsonString);
}

// 이전 버전 호환성 (Base64만 사용한 RP1)
function decodeSettingsLegacy(encoded) {
  const base64 = encoded.slice(4);
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
  const jsonString = new TextDecoder().decode(bytes);
  return JSON.parse(jsonString);
}

// 설정 내보내기
async function exportSettingsToClipboard() {
  const includeToken = elements.includeToken.checked;

  const exportData = {
    _type: 'ReviewPing_Settings_v1',
    connectionType: currentConnectionType,
    channelId: elements.channelId.value.trim(),
    webhookUrl: elements.webhookUrl.value.trim(),
    channelMappings: collectChannelMappings(),
    requestTemplate: elements.requestTemplate.value || DEFAULT_TEMPLATES.request,
    completeTemplate: elements.completeTemplate.value || DEFAULT_TEMPLATES.complete,
    mergeTemplate: elements.mergeTemplate.value || DEFAULT_TEMPLATES.merge,
    mergeNotificationEnabled: elements.mergeNotificationEnabled.checked,
    allowedRepos: collectAllowedRepos(),
    userMappings: collectMappings()
  };

  // 토큰 포함 옵션 - storage에서 직접 가져옴 (가져오기로 받은 토큰도 포함되도록)
  if (includeToken) {
    const stored = await chrome.storage.sync.get(['botToken']);
    if (stored.botToken) {
      exportData.botToken = stored.botToken;
    }
  }

  try {
    const encoded = await encodeSettings(exportData);
    await navigator.clipboard.writeText(encoded);
    showExportResult('클립보드에 복사됨!', true);
  } catch (error) {
    showExportResult('복사 실패: ' + error.message, false);
  }
}

// 설정 가져오기
async function importSettingsFromText() {
  const text = elements.importData.value.trim();

  if (!text) {
    showImportResult('설정 코드를 붙여넣으세요', false);
    return;
  }

  try {
    const data = await decodeSettings(text);

    // 유효성 검사
    if (data._type !== 'ReviewPing_Settings_v1') {
      showImportResult('올바른 ReviewPing 설정이 아닙니다', false);
      return;
    }

    // 값 적용
    if (data.botToken) {
      // 가져온 토큰은 storage에만 저장하고 input에는 표시하지 않음
      await chrome.storage.sync.set({
        botToken: data.botToken,
        tokenFromImport: true
      });
      elements.botToken.value = '';
      elements.botToken.disabled = true;
      elements.botToken.dataset.imported = 'true';
      elements.toggleBotToken.style.display = 'none';
      elements.botTokenHelp.style.display = 'none';
      elements.botTokenImported.style.display = 'block';
    }
    if (data.channelId) {
      elements.channelId.value = data.channelId;
    }
    if (data.webhookUrl) {
      elements.webhookUrl.value = data.webhookUrl;
    }
    if (data.requestTemplate) {
      elements.requestTemplate.value = data.requestTemplate;
    }
    if (data.completeTemplate) {
      elements.completeTemplate.value = data.completeTemplate;
    }
    if (data.mergeTemplate) {
      elements.mergeTemplate.value = data.mergeTemplate;
    }
    if (data.mergeNotificationEnabled !== undefined) {
      elements.mergeNotificationEnabled.checked = data.mergeNotificationEnabled;
    }
    if (data.allowedRepos && Array.isArray(data.allowedRepos)) {
      renderAllowedRepos(data.allowedRepos);
    }
    if (data.userMappings && Array.isArray(data.userMappings)) {
      renderMappings(data.userMappings);
    }
    if (data.channelMappings && Array.isArray(data.channelMappings)) {
      renderChannelMappings(data.channelMappings);
    }
    // 연결 방식 탭 전환
    if (data.connectionType) {
      switchTab(data.connectionType);
    }

    // 입력 필드 초기화
    elements.importData.value = '';

    showImportResult('설정을 불러왔습니다! 저장 버튼을 눌러주세요', true);
  } catch (error) {
    showImportResult(error.message || '올바른 설정 코드가 아닙니다', false);
  }
}

// 내보내기 결과 표시
function showExportResult(message, success) {
  elements.exportResult.textContent = message;
  elements.exportResult.className = `export-result ${success ? 'success' : 'error'}`;

  setTimeout(() => {
    elements.exportResult.textContent = '';
  }, 3000);
}

// 가져오기 결과 표시
function showImportResult(message, success) {
  elements.importResult.textContent = message;
  elements.importResult.className = `import-result ${success ? 'success' : 'error'}`;

  setTimeout(() => {
    elements.importResult.textContent = '';
  }, 5000);
}

// Bot Token 보기/숨기기 토글
function toggleBotTokenVisibility() {
  const input = elements.botToken;
  const button = elements.toggleBotToken;
  const iconEye = button.querySelector('.icon-eye');
  const iconEyeOff = button.querySelector('.icon-eye-off');

  if (input.type === 'password') {
    input.type = 'text';
    iconEye.style.display = 'none';
    iconEyeOff.style.display = 'block';
  } else {
    input.type = 'password';
    iconEye.style.display = 'block';
    iconEyeOff.style.display = 'none';
  }
}

// 새 토큰 입력 버튼 클릭 시 imported 상태 해제
elements.resetBotToken.addEventListener('click', async () => {
  // storage에서 기존 토큰 삭제
  await chrome.storage.sync.set({
    botToken: '',
    tokenFromImport: false
  });

  // UI 초기화
  elements.botToken.value = '';
  elements.botToken.disabled = false;
  elements.botToken.dataset.imported = 'false';
  elements.toggleBotToken.style.display = 'flex';
  elements.botTokenHelp.style.display = 'block';
  elements.botTokenImported.style.display = 'none';
  elements.botToken.focus();
});

// GitHub 토큰 토글
function toggleGithubTokenVisibility() {
  const input = elements.githubToken;
  const eyeIcon = elements.toggleGithubToken.querySelector('.icon-eye');
  const eyeOffIcon = elements.toggleGithubToken.querySelector('.icon-eye-off');

  if (input.type === 'password') {
    input.type = 'text';
    eyeIcon.style.display = 'none';
    eyeOffIcon.style.display = 'block';
  } else {
    input.type = 'password';
    eyeIcon.style.display = 'block';
    eyeOffIcon.style.display = 'none';
  }
}

// 이벤트 리스너
elements.toggleBotToken.addEventListener('click', toggleBotTokenVisibility);
elements.toggleWebhookUrl.addEventListener('click', toggleWebhookUrlVisibility);
elements.toggleGithubToken.addEventListener('click', toggleGithubTokenVisibility);
elements.testConnection.addEventListener('click', testConnection);
elements.testWebhook.addEventListener('click', testWebhookConnection);
elements.saveSettings.addEventListener('click', saveSettings);
elements.resetTemplates.addEventListener('click', resetTemplates);
elements.parseChannelId.addEventListener('click', handleParseChannelId);
elements.addAllowedRepo.addEventListener('click', () => {
  elements.allowedReposList.appendChild(createAllowedRepoRow());
});
elements.addMapping.addEventListener('click', () => {
  elements.mappingList.appendChild(createMappingRow());
});
elements.addChannelMapping.addEventListener('click', () => {
  elements.channelMappingList.appendChild(createChannelMappingRow());
});

// 공유 관련 이벤트 리스너
elements.exportSettings.addEventListener('click', exportSettingsToClipboard);
elements.importSettings.addEventListener('click', importSettingsFromText);

// 버전 표시
document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

// 초기화
loadSettings();
