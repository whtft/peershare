import { PeerConnection, getFileInfo, appendMessage } from './lib.js'

if (navigator.wakeLock) navigator.wakeLock.request('screen')

const LOCATION = new URL(location.href)
const fileInput = document.querySelector('#fileInput')
/** @type {HTMLInputElement} */
const textInput = document.querySelector('#textInput')
const sendTextBtn = document.querySelector('#sendTextBtn')
const header = document.querySelector('#header')

window.history.replaceState({}, document.title, LOCATION.pathname)
document.querySelector('#logo').href = LOCATION.pathname

const PC = new PeerConnection(new URLSearchParams(LOCATION.search).get('code'))

fileInput.addEventListener('change', () => {
    if (!PC?.connection || !fileInput.files.length) return
    PC.send({ event: 'info', fileinfo: getFileInfo(fileInput.files[0]) })
})

textInput.addEventListener('keydown', (e) => {
    if (e.key.includes('Enter')) sendText()
})

sendTextBtn.addEventListener('click', sendText)

function sendText() {
    const message = textInput.value.trim()
    if (message === '') return
    textInput.value = ''
    appendMessage(message, true)
    PC.send({ event: 'message', message })
}

window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 0))
