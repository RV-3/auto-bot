// AdminBlockCalendar.js
import React, { useEffect, useState, useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import { TIMEZONE } from './config'
import allLocales from '@fullcalendar/core/locales-all'
import { isIOS } from 'react-device-detect'
import timeGridPlugin from '@fullcalendar/timegrid'
import scrollGridPlugin from '@fullcalendar/scrollgrid'
import interactionPlugin from '@fullcalendar/interaction'
import LanguageDropdown from './LanguageDropdown'
import moment from 'moment-timezone'
import momentPlugin from '@fullcalendar/moment'
import momentTimezonePlugin from '@fullcalendar/moment-timezone'
import client from './utils/sanityClient.js'
import { useLanguage } from './LanguageContext'
import useTranslate from './useTranslate'

// Components
import { AutoBlockControls } from './admin/AutoBlockControls.js'
import CalendarPasswordPanel from './admin/CalendarPasswordPanel'
import AdminAuthScreen from './admin/AdminAuthScreen'
import ReservationModal from './admin/ReservationModal'

// Manual-block helpers
import {
  isManuallyBlocked,
  handleBlock as rawHandleBlock,
  handleUnblock as rawHandleUnblock
} from './admin/ManualBlockLogic.js'

/**
 * Helper: "x days ago at local midnight" in the chapel’s time zone
 */
function getLocalMidnightXDaysAgo(daysAgo, tz) {
  return moment.tz(tz).startOf('day').subtract(daysAgo, 'days').toDate()
}

export default function AdminBlockCalendar({ chapelSlug }) {
  const { language, setLanguage } = useLanguage()
  const t = useTranslate()

  // 1) Admin Auth State (unconditionally declared)
  const [authenticated, setAuthenticated] = useState(
    localStorage.getItem('isAdmin') === 'true'
  )

  // 2) Chapel + password data
  const [chapel, setChapel] = useState(null)
  const [calendarPasswordDocId, setCalendarPasswordDocId] = useState(null)
  const [currentCalendarPassword, setCurrentCalendarPassword] = useState('')

  // 3) Blocks, Reservations, AutoBlock
  const [blocks, setBlocks] = useState([])
  const [reservations, setReservations] = useState([])
  const [autoBlockRules, setAutoBlockRules] = useState([])
  const [autoBlockDays, setAutoBlockDays] = useState(null)
  const [pastBlockEvent, setPastBlockEvent] = useState(null)

  // 4) UI references & states
  const calendarRef = useRef(null)
  const platformDelay = isIOS ? 100 : 47
  const [modalIsOpen, setModalIsOpen] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState(null)

  /**
   * 5) fetchCalendarPassword
   */
  const fetchCalendarPassword = useCallback(async (chapelId) => {
    try {
      const pwDoc = await client.fetch(
        `*[_type == "calendarPassword" && chapel._ref == $chapelId][0]{
          _id,
          password
        }`,
        { chapelId }
      )
      if (pwDoc) {
        setCalendarPasswordDocId(pwDoc._id)
        setCurrentCalendarPassword(pwDoc.password || '')
      } else {
        setCalendarPasswordDocId(null)
        setCurrentCalendarPassword('')
      }
    } catch (err) {
      console.error('Error fetching chapel-specific calendar password:', err)
      setCalendarPasswordDocId(null)
      setCurrentCalendarPassword('')
    }
  }, [])

  /**
   * handleSavePassword / handleRemovePassword
   */
  const handleSavePassword = useCallback(
    async (newPw, chapelId, existingDocId) => {
      if (!chapelId) {
        alert(t({ en: 'No chapel ID found. Cannot save password.' }))
        return
      }
      try {
        const finalDocId = existingDocId || `calendarPassword-${chapelId}`
        await client.createOrReplace({
          _id: finalDocId,
          _type: 'calendarPassword',
          chapel: { _ref: chapelId, _type: 'reference' },
          password: newPw
        })
        alert(t({ en: 'Password saved to Sanity.' }))
        setCurrentCalendarPassword(newPw)
        setCalendarPasswordDocId(finalDocId)
      } catch (err) {
        console.error('Error saving password:', err)
        alert(t({ en: 'Failed to save password.' }))
      }
    },
    [t]
  )

  const handleRemovePassword = useCallback(
    async (chapelId, docId) => {
      if (
        !window.confirm(
          t({ en: 'Are you sure you want to remove the calendar password?' })
        )
      ) {
        return
      }
      if (!docId) {
        alert(t({ en: 'No password doc for this chapel. Nothing to remove.' }))
        return
      }
      try {
        await client.createOrReplace({
          _id: docId,
          _type: 'calendarPassword',
          chapel: { _ref: chapelId, _type: 'reference' },
          password: ''
        })
        alert(t({ en: 'Password removed (set to empty).' }))
        setCurrentCalendarPassword('')
      } catch (err) {
        console.error('Error removing password:', err)
        alert(t({ en: 'Failed to remove password.' }))
      }
    },
    [t]
  )

  /**
   * 6) fetchData effect: includes a check if not authenticated => skip
   */
  const fetchData = useCallback(async () => {
    // If no slug or not authenticated => skip
    if (!chapelSlug) return
    if (!authenticated) return

    const calendarApi = calendarRef.current?.getApi()
    const currentViewDate = calendarApi?.getDate()

    try {
      const chapelDoc = await client.fetch(
        `*[_type == "chapel" && slug.current == $slug][0]{
          _id,
          name,
          nickname,
          timezone,
          language
        }`,
        { slug: chapelSlug }
      )
      if (!chapelDoc) {
        console.warn('No chapel found with slug:', chapelSlug)
        return
      }
      setChapel(chapelDoc)

      // If there's a default language => set context
      if (chapelDoc.language) {
        setLanguage(chapelDoc.language)
      }

      // Password doc
      await fetchCalendarPassword(chapelDoc._id)

      // Manual blocks
      const blocksData = await client.fetch(
        `*[_type == "blocked" && chapel._ref == $chapelId]{_id, start, end}`,
        { chapelId: chapelDoc._id }
      )
      setBlocks(blocksData)

      // Reservations
      const resData = await client.fetch(
        `*[_type == "reservation" && chapel._ref == $chapelId]{
          _id,
          name,
          phone,
          start,
          end,
          chapel-> { _id, name }
        }`,
        { chapelId: chapelDoc._id }
      )
      setReservations(resData)

      // Hour-based autoBlock
      const autoData = await client.fetch(
        `*[_type == "autoBlockedHours" && chapel._ref == $chapelId]{
          _id,
          startHour,
          endHour,
          timeExceptions[]{ date, startHour, endHour }
        }`,
        { chapelId: chapelDoc._id }
      )
      setAutoBlockRules(autoData)

      // Day-based autoBlock
      const daysDocArr = await client.fetch(
        `*[_type == "autoBlockedDays" && chapel._ref == $chapelId]{
          _id,
          daysOfWeek,
          timeExceptions[]{ date, startHour, endHour }
        }`,
        { chapelId: chapelDoc._id }
      )
      setAutoBlockDays(daysDocArr.length ? daysDocArr[0] : null)

      // Restore FullCalendar date if possible
      if (calendarApi && currentViewDate) {
        calendarApi.gotoDate(currentViewDate)
      }
    } catch (err) {
      console.error('Error loading data from Sanity:', err)
    }
  }, [chapelSlug, authenticated, setLanguage, fetchCalendarPassword])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  /**
   * 7) Past-block overlay effect: skip if not authenticated or no chapel
   */
  useEffect(() => {
    if (!authenticated) return
    if (!chapel?.timezone) return

    function updatePastBlockEvent() {
      const adminTZ = chapel.timezone || TIMEZONE
      const earliest = getLocalMidnightXDaysAgo(7, adminTZ)
      const now = moment.tz(adminTZ).toDate()
      setPastBlockEvent({
        id: 'past-block',
        start: earliest,
        end: now,
        display: 'background',
        color: '#6e6e6e'
      })
    }
    updatePastBlockEvent()

    const interval = setInterval(updatePastBlockEvent, 60 * 1000)
    return () => clearInterval(interval)
  }, [authenticated, chapel])

  /**
   * 8) If not authenticated => show AdminAuthScreen
   */
  if (!authenticated) {
    return <AdminAuthScreen onSuccess={setAuthenticated} />
  }

  /**
   * 9) Now we safely render the admin panel, including the LanguageDropdown
   */
  const adminTZ = chapel?.timezone || TIMEZONE

  // --------------- BLOCK / RESERVATION LOGIC ---------------
  function isRangeCompletelyBlocked(info) {
    const slotStart = new Date(info.start)
    const slotEnd = new Date(info.end)
    let cursor = slotStart
    while (cursor < slotEnd) {
      const nextHour = new Date(cursor.getTime() + 3600000)
      if (!isManuallyBlocked(cursor, nextHour, blocks) && !isAutoBlocked(cursor, nextHour)) {
        return false
      }
      cursor = nextHour
    }
    return true
  }

  function isAutoBlocked(hStart, hEnd) {
    if (autoBlockDays?.daysOfWeek?.length) {
      const dayName = moment.tz(hStart, adminTZ).format('dddd')
      if (autoBlockDays.daysOfWeek.includes(dayName)) {
        if (!dayExceptionCheck(hStart, hEnd)) {
          return true
        }
      }
    }
    return autoBlockRules.some((rule) => hourRuleCheck(rule, hStart, hEnd))
  }

  function dayExceptionCheck(hStart, hEnd) {
    if (!autoBlockDays?.timeExceptions?.length) return false
    const sLocal = moment.tz(hStart, adminTZ)
    const eLocal = moment.tz(hEnd, adminTZ)
    const dateStr = sLocal.format('YYYY-MM-DD')
    return autoBlockDays.timeExceptions.some((ex) => {
      if (!ex.date) return false
      if (ex.date.slice(0, 10) !== dateStr) return false
      const exDay = sLocal.clone().startOf('day')
      const exStart = exDay.clone().hour(parseInt(ex.startHour || '0', 10))
      const exEnd = exDay.clone().hour(parseInt(ex.endHour || '0', 10))
      return sLocal.isBefore(exEnd) && eLocal.isAfter(exStart)
    })
  }

  function hourRuleCheck(rule, hStart, hEnd) {
    const sLocal = moment.tz(hStart, adminTZ)
    const eLocal = moment.tz(hEnd, adminTZ)
    const dayAnchor = sLocal.clone().startOf('day')
    const rStart = dayAnchor.clone().hour(parseInt(rule.startHour, 10))
    const rEnd = dayAnchor.clone().hour(parseInt(rule.endHour, 10))

    if (sLocal.isBefore(rStart) || eLocal.isAfter(rEnd)) {
      return false
    }
    // Check exceptions
    return !rule.timeExceptions?.some((ex) => {
      if (!ex.date) return false
      if (ex.date.slice(0, 10) !== sLocal.format('YYYY-MM-DD')) return false
      const exDay = sLocal.clone().startOf('day')
      const exStart = exDay.clone().hour(parseInt(ex.startHour || '0', 10))
      const exEnd = exDay.clone().hour(parseInt(ex.endHour || '0', 10))
      return sLocal.isBefore(exEnd) && eLocal.isAfter(exStart)
    })
  }

  /**
   * Build events for FullCalendar
   */
  function loadEvents(fetchInfo, successCallback) {
    const { start, end } = fetchInfo
    const evts = []

    // 1) Real Reservations
    reservations.forEach((r) => {
      evts.push({
        id: r._id,
        title: r.name,
        start: r.start,
        end: r.end,
        color: '#3788d8'
      })
    })

    // 2) Manual blocks => background
    blocks.forEach((b) => {
      evts.push({
        id: b._id,
        title: 'Blocked',
        start: b.start,
        end: b.end,
        display: 'background',
        color: '#999999'
      })
    })

    // 3) Day-based expansions
    if (autoBlockDays) {
      const daySlices = getDaySlices(autoBlockDays, start, end)
      daySlices.forEach(([s, e]) => {
        if (!fullyCoveredByManual(s, e)) {
          evts.push({
            id: `auto-day-${autoBlockDays._id}-${s.toISOString()}`,
            title: 'Blocked',
            start: s,
            end: e,
            display: 'background',
            color: '#999999'
          })
        }
      })
    }

    // 4) Hour-based expansions
    autoBlockRules.forEach((rule) => {
      const hourSlices = getHourSlices(rule, start, end)
      hourSlices.forEach(([s, e]) => {
        if (!fullyCoveredByManual(s, e)) {
          evts.push({
            id: `auto-hour-${rule._id}-${s.toISOString()}`,
            title: 'Blocked',
            start: s,
            end: e,
            display: 'background',
            color: '#999999'
          })
        }
      })
    })

    // 5) Past-block overlay
    if (pastBlockEvent) {
      evts.push(pastBlockEvent)
    }

    successCallback(evts)
  }

  function getHourSlices(rule, dayStart, dayEnd) {
    const slices = []
    const startLocal = moment.tz(dayStart, adminTZ).startOf('day')
    const endLocal = moment.tz(dayEnd, adminTZ).endOf('day')

    while (startLocal.isSameOrBefore(endLocal, 'day')) {
      for (let h = parseInt(rule.startHour, 10); h < parseInt(rule.endHour, 10); h++) {
        const sliceStart = startLocal.clone().hour(h)
        const sliceEnd = sliceStart.clone().add(1, 'hour')
        if (sliceEnd <= dayStart || sliceStart >= dayEnd) continue
        if (!hourRuleCheck(rule, sliceStart.toDate(), sliceEnd.toDate())) {
          continue
        }
        slices.push([sliceStart.toDate(), sliceEnd.toDate()])
      }
      startLocal.add(1, 'day').startOf('day')
    }
    return mergeSlices(slices)
  }

  function getDaySlices(dayDoc, rangeStart, rangeEnd) {
    const slices = []
    if (!dayDoc.daysOfWeek?.length) return slices

    const currentLocal = moment.tz(rangeStart, adminTZ).startOf('day')
    const limitLocal = moment.tz(rangeEnd, adminTZ).endOf('day')

    while (currentLocal.isBefore(limitLocal)) {
      const dayName = currentLocal.format('dddd')
      if (dayDoc.daysOfWeek.includes(dayName)) {
        for (let h = 0; h < 24; h++) {
          const sliceStart = currentLocal.clone().hour(h)
          const sliceEnd = sliceStart.clone().add(1, 'hour')
          if (sliceEnd <= rangeStart || sliceStart >= rangeEnd) continue
          if (dayDocExceptionCheck(dayDoc, sliceStart.toDate(), sliceEnd.toDate())) {
            continue
          }
          slices.push([sliceStart.toDate(), sliceEnd.toDate()])
        }
      }
      currentLocal.add(1, 'day').startOf('day')
    }
    return mergeSlices(slices)
  }

  function dayDocExceptionCheck(dayDoc, hStart, hEnd) {
    if (!dayDoc?.timeExceptions?.length) return false
    const sLocal = moment.tz(hStart, adminTZ)
    const eLocal = moment.tz(hEnd, adminTZ)
    const dateStr = sLocal.format('YYYY-MM-DD')
    return dayDoc.timeExceptions.some((ex) => {
      if (!ex.date) return false
      if (ex.date.slice(0, 10) !== dateStr) return false
      const exDay = sLocal.clone().startOf('day')
      const exStart = exDay.clone().hour(parseInt(ex.startHour || '0', 10))
      const exEnd = exDay.clone().hour(parseInt(ex.endHour || '0', 10))
      return sLocal.isBefore(exEnd) && eLocal.isAfter(exStart)
    })
  }

  function mergeSlices(slices) {
    if (!slices.length) return []
    slices.sort((a, b) => a[0] - b[0])
    const merged = [slices[0]]
    for (let i = 1; i < slices.length; i++) {
      const prev = merged[merged.length - 1]
      const curr = slices[i]
      if (prev[1].getTime() === curr[0].getTime()) {
        prev[1] = curr[1]
      } else {
        merged.push(curr)
      }
    }
    return merged
  }

  function fullyCoveredByManual(start, end) {
    let cursorCheck = new Date(start)
    while (cursorCheck < end) {
      const nxt = new Date(cursorCheck.getTime() + 3600000)
      if (!isManuallyBlocked(cursorCheck, nxt, blocks)) {
        return false
      }
      cursorCheck = nxt
    }
    return true
  }

  function handleEventContent(arg) {
    if (arg.event.display === 'background') return null
    return <div>{arg.event.title}</div>
  }

  function handleEventClick(clickInfo) {
    const r = reservations.find((x) => x._id === clickInfo.event.id)
    if (r) {
      setSelectedReservation(r)
      setModalIsOpen(true)
    }
  }

  async function handleDeleteReservation() {
    if (!selectedReservation) return
    if (!window.confirm(t({ en: 'Delete this reservation?' }))) {
      return
    }
    await client.delete(selectedReservation._id)
    fetchData()
    setModalIsOpen(false)
    setSelectedReservation(null)
  }

  function handleBlock(info) {
    if (!chapel) {
      alert(t({ en: 'No chapel found. Cannot block.' }))
      return
    }
    return rawHandleBlock(info, blocks, t, fetchData, chapel._id, adminTZ)
  }

  function handleUnblock(info) {
    return rawHandleUnblock(info, blocks, autoBlockRules, autoBlockDays, t, fetchData, adminTZ)
  }

  // Constrain FullCalendar to 7 days in the past, 30 in the future
  const now = new Date()
  const validRangeStart = new Date(now)
  validRangeStart.setHours(0, 0, 0, 0)
  validRangeStart.setDate(validRangeStart.getDate() - 7)

  const validRangeEnd = new Date(now)
  validRangeEnd.setDate(validRangeEnd.getDate() + 30)

  return (
    <div style={{ padding: '1rem' }}>
      {/*
        Because we've declared Hooks unconditionally above,
        we do not return <AdminAuthScreen> early.
        Instead, that is done after the Hooks are declared (line ~101).
      */}

      {/* The user is now authenticated => show the dropdown + admin UI */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        {chapel && <LanguageDropdown chapelId={chapel._id} />}
      </div>

      <h2 style={{ textAlign: 'center', marginBottom: '1rem', fontSize: '1.8rem' }}>
        {t({
          en: 'Admin Panel',
          de: 'Admin-Bereich',
          es: 'Panel de Administración',
          ar: 'لوحة الإدارة'
        })}
      </h2>

      {chapel && (
        <p style={{ textAlign: 'center', fontWeight: 'bold' }}>
          {t({
            en: 'Managing Chapel: ',
            de: 'Verwaltung der Kapelle: ',
            es: 'Gestionando capilla: ',
            ar: 'إدارة الكنيسة: '
          })}
          {chapel.name}
        </p>
      )}

      {/* Chapel password panel */}
      <CalendarPasswordPanel
        chapelId={chapel?._id || null}
        existingPasswordDocId={calendarPasswordDocId}
        currentCalendarPassword={currentCalendarPassword}
        onSavePassword={handleSavePassword}
        onRemovePassword={handleRemovePassword}
      />

      {/* Auto-Block Controls */}
      <AutoBlockControls
        chapelId={chapel?._id || null}
        autoBlockRules={autoBlockRules}
        setAutoBlockRules={setAutoBlockRules}
        autoBlockDays={autoBlockDays}
        setAutoBlockDays={setAutoBlockDays}
        reloadData={fetchData}
      />

      <FullCalendar
        ref={calendarRef}
        locales={allLocales}
        locale={
          language === 'ar'
            ? 'ar'
            : language === 'de'
            ? 'de'
            : language === 'es'
            ? 'es'
            : 'en'
        }
        plugins={[
          timeGridPlugin,
          scrollGridPlugin,
          interactionPlugin,
          momentPlugin,
          momentTimezonePlugin
        ]}
        timeZone={chapel?.timezone || TIMEZONE}
        initialView="timeGrid30Day"
        views={{
          timeGrid30Day: {
            type: 'timeGrid',
            duration: { days: 30 },
            dayCount: 30,
            buttonText: '30 days'
          }
        }}
        dayMinWidth={240}
        allDaySlot={false}
        slotDuration="01:00:00"
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        height="auto"
        stickyHeaderDates
        stickyFooterScrollbar={false}
        longPressDelay={platformDelay}
        selectLongPressDelay={platformDelay}
        eventLongPressDelay={platformDelay}
        validRange={{
          start: validRangeStart.toISOString(),
          end: validRangeEnd.toISOString()
        }}
        selectable
        selectAllow={(selectInfo) => new Date(selectInfo.startStr) >= new Date()}
        select={(info) => {
          if (isRangeCompletelyBlocked(info)) {
            if (
              window.confirm(
                t({
                  en: 'Unblock this time slot?',
                  de: 'Dieses Zeitfenster freigeben?',
                  es: '¿Desbloquear este intervalo de tiempo?',
                  ar: 'هل تريد إلغاء حظر هذه الفترة الزمنية؟'
                })
              )
            ) {
              handleUnblock(info)
            }
          } else {
            if (
              window.confirm(
                t({
                  en: 'Block this time slot?',
                  de: 'Dieses Zeitfenster blockieren?',
                  es: '¿Bloquear este intervalo de tiempo?',
                  ar: 'هل تريد حظر هذه الفترة الزمنية؟'
                })
              )
            ) {
              handleBlock(info)
            }
          }
        }}
        events={loadEvents}
        eventContent={handleEventContent}
        eventClick={handleEventClick}
        headerToolbar={{
          left: 'prev,next',
          center: 'title',
          right: ''
        }}
        dayHeaderFormat={{
          weekday: 'short',
          month: 'numeric',
          day: 'numeric',
          omitCommas: true
        }}
        slotLabelFormat={(dateInfo) => moment(dateInfo.date).format('h A')}
      />

      <ReservationModal
        isOpen={modalIsOpen}
        onClose={() => setModalIsOpen(false)}
        reservation={selectedReservation}
        onDelete={handleDeleteReservation}
      />
    </div>
  )
}
