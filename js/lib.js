import { Peer } from './peerjs.min.js'
import { sendBtn, fileInput, connectBtn, main, textBox, LOCATION, scrollToBottom } from './index.js'

const chunk_size = 16_300
const max_buffer = 16_000_000 / 2

export class PeerConnection {
    peer
    connection
    /** @type {TransferElement} */
    download
    /** @type {TransferElement} */
    upload
    file
    constructor(rpid) {
        this.peer = new Peer()
        this.peer.on('open', (pid) => this.onPeerOpen(pid, rpid))
        this.peer.on('connection', (conn) => this.onPeerConnection(conn))
    }
    onPeerOpen(pid, rpid) {
        console.log('PEER OPEN', pid)
        if (rpid) this.onPeerConnection(this.peer.connect(rpid, { reliable: true }))
        else this.appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${pid}`)
    }
    connectTo(rpid) {
        if (rpid) this.onPeerConnection(this.peer.connect(rpid, { reliable: true }))
    }
    onPaste(clipboardData) {
        if (!clipboardData.types.includes('Files')) return
        if (sendBtn.hasAttribute('data-disabled')) return
        this.send({ event: 'info', fileinfo: getFileInfo(clipboardData.files[0]) }, clipboardData.files[0])
    }
    onPeerConnection(conn) {
        this.connection = conn
            .on('open', () => {
                main.replaceChildren()
                disableUploadButton(false)
                hideTextBox(false)
                connectBtn.toggleAttribute('hidden', true)
                console.log('CONNECTION ESTABLISHED', this.connection.peer)
                this.connection.dataChannel.onmessage = (m) => this.onDataChannelMessage(m)
            })
            .on('close', () => {
                disableUploadButton(true)
                hideTextBox(true)
                connectBtn.toggleAttribute('hidden', false)
                console.log('CONNECTION CLOSED')
                if (main.matches(':empty')) {
                    this.appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${this.peer.id}`)
                }
            })
            .on('error', (error) => {
                disableUploadButton(true)
                hideTextBox(true)
                connectBtn.toggleAttribute('hidden', false)
                console.log('CONNECTION ERROR')
                console.error(error)
            })
    }
    send(data, file = null) {
        if (file) this.file = file
        if (data.chunk) this.connection.dataChannel.send(new Blob([data.index, data.chunk]))
        else this.connection.dataChannel.send(JSON.stringify(data))
    }
    async sendFile(file) {
        let start = 0
        const index = new Uint32Array([0])
        while (start < file.size) {
            if (this.upload.cancelled) return
            if (!this.connection.dataChannel) return this.upload.cancel()
            if (this.connection.dataChannel.bufferedAmount > max_buffer) {
                await new Promise((res) => setTimeout(res, 50))
                continue
            }

            const chunk = file.slice(start, start + chunk_size + 1)
            this.send({ index, chunk })
            start += chunk.size
            index[0]++

            this.upload.setProgress(Math.round((start / file.size) * 100))
            const ptext = `▲ ${formatBytes(start)} / ${formatBytes(file.size)}`
            this.upload.setInfos(ptext)
            // const bitrate = formatBytes(Math.round(start / (Date.now() - this.upload.ts)) * 1000) + '/s'
        }
        this.upload.appendContent(URL.createObjectURL(file), file.type)
    }
    onDataChannelMessage(message) {
        if (typeof message.data != 'string') this.dataHandler(message)
        else this.messageHandler(JSON.parse(message.data))
    }
    messageHandler(data) {
        if (data.event == 'info') {
            this.download = new TransferElement(data.fileinfo, false)
            this.download.oncancel = () => this.send({ event: 'cancel', dir: 'down' })
            this.download.setBusy(true)
            this.send({ event: 'ready' })
        } else if (data.event == 'ready') {
            this.upload = new TransferElement(getFileInfo(this.file), true)
            this.upload.oncancel = () => {
                this.send({ event: 'cancel', dir: 'up' })
                disableUploadButton(false)
            }
            this.sendFile(this.file)
            this.upload.setBusy(true)
            disableUploadButton(true)
        } else if (data.event == 'end') {
            this.upload.setBusy(false)
            disableUploadButton(false)
            this.upload.setInfos(null, '✓')
        } else if (data.event == 'cancel') {
            if (data.dir == 'up') this.download.cancel()
            else {
                this.upload.cancel()
                disableUploadButton(false)
            }
        } else if (data.event == 'message') {
            appendMessage(data.message, false)
        }
    }
    dataHandler(message) {
        if (this.download.cancelled) return

        const index = new DataView(message.data.slice(0, 4)).getUint32(0, true)
        this.download.received += message.data.byteLength - 4
        this.download.fb[index] = message.data.slice(4)

        const percent = Math.round((this.download.received / this.download.fi.size) * 100)
        this.download.setProgress(percent)
        const ptext = `▼ ${formatBytes(this.download.received)} / ${formatBytes(this.download.fi.size)}`
        const bitrate = formatBytes(Math.round(this.download.received / (Date.now() - this.download.ts)) * 1000) + '/s'
        this.download.setInfos(ptext + ' - ' + bitrate)

        if (this.download.received == this.download.fi.size) {
            this.download.setBusy(false)
            this.download.setInfos(null, '✓')
            const url = URL.createObjectURL(new Blob(this.download.fb, { type: this.download.fi.type }))
            this.download.setUrl(url)
            this.send({ event: 'end' })
            this.download.appendContent(url, this.download.fi.type)
        }
    }
    appendQRCode(text) {
        const qr = document.createElement(LOCATION.protocol === 'https:' ? 'div' : 'a')
        qr.id = 'code'
        qr.href = text
        new QRCode(qr, { text, colorDark: '#13171f', correctLevel: QRCode.CorrectLevel.H })
        qr.title = ''
        qr.querySelectorAll('img, canvas').forEach((e) => (e.draggable = false))
        main.replaceChildren(qr)
    }
}

export function appendMessage(textContent, sender = false) {
    const messageEl = Object.assign(document.createElement('div'), { className: 'text-message', textContent })
    messageEl.classList.toggle('sender', sender)
    main.append(messageEl)
    scrollToBottom()
}

export class TransferElement {
    #wrapper
    #anchor
    #infosL
    #infosR
    #cancelBtn
    #progress
    fb = []
    received = 0
    ts = Date.now()
    fi
    cancelled = false
    oncancel = () => {}
    constructor(fileInfo, sender) {
        this.fi = fileInfo
        this.#wrapper = Object.assign(document.createElement('div'), { className: 'text-message' })
        if (sender) this.#wrapper.classList.add('sender')
        const infoWrapper = Object.assign(document.createElement('div'), { className: 'infos' })
        this.#infosL = document.createElement('div')
        this.#infosR = document.createElement('div')
        infoWrapper.append(this.#infosL, this.#infosR)
        this.#anchor = Object.assign(document.createElement('a'), {
            textContent: fileInfo.name,
            download: fileInfo.name,
            className: 'file-link secondary',
        })
        this.#cancelBtn = Object.assign(document.createElement('a'), { textContent: 'cancel' })
        this.#cancelBtn.addEventListener('click', (e) => {
            e.preventDefault()
            this.cancel()
            this.oncancel()
        })
        this.setInfos(null, this.#cancelBtn)
        this.#progress = Object.assign(document.createElement('div'), { className: 'pbar' })
        this.#wrapper.append(this.#anchor, infoWrapper, this.#progress)
        main.append(this.#wrapper)
        this.#wrapper.scrollIntoView()
    }
    remove() {
        this.#wrapper.remove()
    }
    appendContent(src, type) {
        let element
        if (type.includes('image')) {
            element = Object.assign(document.createElement('a'), { href: src, target: '_blank' })
            const img = Object.assign(document.createElement('img'), { src })
            element.append(img)
            img.onload = () => scrollToBottom()
        } else if (type.includes('video')) {
            element = Object.assign(document.createElement('video'), { src, controls: true })
            element.onloadedmetadata = () => scrollToBottom()
        }

        if (element) this.#anchor.insertAdjacentElement('afterend', element)
    }
    cancel() {
        this.cancelled = true
        this.setInfos(null, '✗')
        this.setBusy(false)
    }
    setInfos(left, right) {
        if (!isNill(left)) {
            if (typeof left == 'string') this.#infosL.textContent = left
            else this.#infosL.replaceChildren(left)
        }
        if (!isNill(right)) {
            if (typeof right == 'string') this.#infosR.textContent = right
            else this.#infosR.replaceChildren(right)
        }
    }
    setProgress(percent) {
        percent = Math.max(0, Math.min(100, percent))
        this.#progress.style.width = `${percent}%`
    }
    setBusy(busy) {
        // this.#anchor.setAttribute('aria-busy', busy)
        if (!busy) this.#cancelBtn.remove()
    }
    setUrl(url) {
        this.#anchor.href = url
        this.#anchor.classList.remove('secondary')
    }
}

function isNill(obj) {
    return obj === null || obj === undefined
}

function disableUploadButton(disable) {
    sendBtn.toggleAttribute('data-disabled', disable)
}

function hideTextBox(hidden) {
    textBox.toggleAttribute('hidden', hidden)
}

export function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = Math.max(0, decimals)
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i]
}

export function getFileInfo(file) {
    return { name: file.name, size: file.size, type: file.type }
}
