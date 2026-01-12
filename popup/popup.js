// ReviewPing - Popup Script

const elements = {
  status: document.getElementById('status'),
  statusMessage: document.getElementById('statusMessage'),
  prInfo: document.getElementById('prInfo'),
  prTitle: document.getElementById('prTitle'),
  prRepo: document.getElementById('prRepo'),
  prNumber: document.getElementById('prNumber'),
  openOptions: document.getElementById('openOptions'),
  guide: document.getElementById('guide')
};

// 설정 상태 확인
async function checkSettings() {
  const settings = await chrome.storage.sync.get(['botToken', 'channelId']);

  if (settings.botToken && settings.channelId) {
    elements.status.className = 'status connected';
    elements.statusMessage.textContent = 'Slack 연결됨';
    document.querySelector('.status-icon').textContent = '✅';
  } else {
    elements.status.className = 'status error';
    elements.statusMessage.textContent = '설정이 필요합니다';
    document.querySelector('.status-icon').textContent = '⚠️';
  }
}

// 현재 탭 정보 확인
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && tab.url.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)) {
      // PR 페이지인 경우
      const match = tab.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (match) {
        elements.prInfo.classList.remove('hidden');
        elements.prRepo.textContent = `${match[1]}/${match[2]}`;
        elements.prNumber.textContent = `#${match[3]}`;
        elements.prTitle.textContent = tab.title.replace(' · Pull Request', '').split(' by ')[0];
        elements.guide.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error checking current tab:', error);
  }
}

// 이벤트 리스너
elements.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 초기화
checkSettings();
checkCurrentTab();
