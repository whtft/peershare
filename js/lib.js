import { Peer } from './peerjs.min.js'

const chunk_size = 16_300
const max_buffer = 16_000_000 / 2

const LOCATION = new URL(location.href)
const main = document.querySelector('#main')
const fileInput = document.querySelector('#fileInput')
const fileInputLbl = document.querySelector('#fileInputLbl')

export class PeerConnection {
    peer
    connection
    /** @type {TransferElement} */
    download
    /** @type {TransferElement} */
    upload
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
    onPeerConnection(conn) {
        main.replaceChildren()
        this.connection = conn
            .on('open', () => {
                disableUploadButton(false)
                console.log('CONNECTION ESTABLISHED', this.connection.peer)
                this.connection.dataChannel.onmessage = (m) => this.onDataChannelMessage(m)
            })
            .on('close', () => {
                disableUploadButton(true)
                console.log('CONNECTION CLOSED')
                if (main.matches(':empty')) {
                    this.appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${this.peer.id}`)
                }
            })
            .on('error', (error) => {
                disableUploadButton(true)
                console.log('CONNECTION ERROR')
                console.error(error)
            })
    }
    send(data) {
        if (data.chunk) this.connection.dataChannel.send(new Blob([data.index, data.chunk]))
        else this.connection.dataChannel.send(JSON.stringify(data))
    }
    onDataChannelMessage(message) {
        if (typeof message.data != 'string') this.onMessage(message)
        else this.messageHandler(JSON.parse(message.data))
    }
    messageHandler(data) {
        if (data.event == 'info') {
            this.download = new TransferElement(data.fileinfo)
            this.send({ event: 'ready' })
        } else if (data.event == 'ready') {
            this.upload = new TransferElement(getFileInfo(fileInput.files[0]))
            this.sendFile(fileInput.files[0])
            disableUploadButton(true)
        } else if (data.event == 'end') {
            disableUploadButton(false)
            const sz = formatBytes(this.upload.fi.size)
            this.upload.el.setAttribute('data-info', `${sz} / ${sz} ✓`)
        }
    }
    async sendFile(file) {
        let start = 0
        const index = new Uint32Array([0])
        while (start < file.size) {
            if (this.connection.dataChannel.bufferedAmount > max_buffer) {
                await new Promise((res) => setTimeout(res, 50))
                continue
            }
            const chunk = file.slice(start, start + chunk_size + 1)
            this.send({ index, chunk })
            start += chunk.size
            index[0]++

            this.upload.setProgress(Math.round((start / file.size) * 100))
            const ptext = `${formatBytes(start)} / ${formatBytes(file.size)}`
            this.upload.el.setAttribute('data-info', ptext)
            // const bitrate = formatBytes(Math.round(start / (Date.now() - this.upload.ts)) * 1000) + '/s'
            // this.upload.el.setAttribute('data-info2', bitrate)
        }
    }
    onMessage(message) {
        const index = new DataView(message.data.slice(0, 4)).getUint32(0, true)

        this.download.received += message.data.byteLength - 4
        this.download.fb[index] = message.data.slice(4)

        const percent = Math.round((this.download.received / this.download.fi.size) * 100)
        this.download.setProgress(percent)
        const ptext = `${formatBytes(this.download.received)} / ${formatBytes(this.download.fi.size)}`
        this.download.el.setAttribute('data-info', ptext)
        const bitrate = formatBytes(Math.round(this.download.received / (Date.now() - this.download.ts)) * 1000) + '/s'
        this.download.el.setAttribute('data-info2', bitrate)

        if (this.download.received == this.download.fi.size) {
            this.download.el.classList.remove('secondary')
            this.download.el.setAttribute('data-info', ptext + ' ✓')
            this.download.el.href = URL.createObjectURL(new Blob(this.download.fb, { type: this.download.fi.type }))
            this.download.el.scrollIntoView()
            this.send({ event: 'end' })
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

export class TransferElement {
    el
    fb = []
    received = 0
    ts = Date.now()
    fi
    constructor(fileInfo) {
        this.fi = fileInfo
        this.el = Object.assign(document.createElement('a'), {
            textContent: fileInfo.name,
            download: fileInfo.name,
            role: 'button',
            className: 'file-link secondary',
        })
        main.append(this.el)
        this.el.scrollIntoView()
    }
    setProgress(percent) {
        percent = Math.max(0, Math.min(100, percent))
        this.el.style.setProperty('--percent', `${percent}%`)
    }
}

function disableUploadButton(disable) {
    fileInputLbl.toggleAttribute('disabled', disable)
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
