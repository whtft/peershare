import { PeerConnection, getFileInfo } from './lib.js'

if (navigator.wakeLock) navigator.wakeLock.request('screen')

const LOCATION = new URL(location.href)
const fileInput = document.querySelector('#fileInput')
const header = document.querySelector('#header')

window.history.replaceState({}, document.title, LOCATION.pathname)
document.querySelector('#logo').href = LOCATION.pathname

const PC = new PeerConnection(new URLSearchParams(LOCATION.search).get('code'))

fileInput.addEventListener('change', () => {
    if (!PC?.connection || !fileInput.files.length) return
    PC.send({ event: 'info', fileinfo: getFileInfo(fileInput.files[0]) })
})

window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 0))
