import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { api, fullName, shortDate } from '../lib/api';

/*
 * Registration.
 *
 * NOTHING ON THIS FORM IS REQUIRED, and that is not an oversight to be tidied
 * up later — it is the module's governing rule. There is no red asterisk, no
 * "please complete all fields", and the Register button is never disabled for
 * missing data.
 *
 * A receptionist facing a required field she cannot fill will type something: a
 * full stop, "unknown", a guessed surname. That guess then looks exactly like
 * data for the next fifteen years and no later process can tell them apart. An
 * empty field is honest.
 *
 * What the form DOES do is warn — about possible duplicates, and about missing
 * fields at the moment of submitting — without ever refusing.
 */

const SEX = ['female', 'male', 'other', 'unknown'];
const MARITAL = ['single', 'married', 'divorced', 'widowed', 'separated'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPE = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'];
const PAYERS = ['self', 'hmo', 'nhis', 'corporate'];
const ID_TYPES = ['nin', 'nhis', 'hmo', 'passport', 'legacy-folder'];

// Fields worth chasing later. Not required — this list only decides what the
// "some details are missing" note mentions before you submit.
const WORTH_HAVING = [
  ['surname', 'Surname'], ['firstName', 'First name'], ['sex', 'Sex'],
  ['dateOfBirth', 'Date of birth'], ['phone', 'Phone number'], ['address', 'Address']
];

function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="field__error">{error}</small>}
    </label>
  );
}

export default function PatientNew() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [patient, setPatient] = useState({
    surname: params.get('surname') ?? '', firstName: '', otherNames: '',
    sex: '', dateOfBirth: '', phone: '', altPhone: '', email: '',
    address: '', city: '', state: '',
    nationality: '', stateOfOrigin: '', maritalStatus: '', occupation: '',
    bloodGroup: '', genotype: '', knownAllergies: ''
  });

  const [kin, setKin] = useState({ name: '', relationship: '', phone: '', address: '' });
  const [payer, setPayer] = useState({ payerType: 'self', payerName: '', policyNumber: '' });
  const [identifier, setIdentifier] = useState({ type: 'nin', value: '' });
  const [visit, setVisit] = useState({ type: 'outpatient', department: '', doctor: '' });
  const [openVisit, setOpenVisit] = useState(true);

  const [duplicates, setDuplicates] = useState([]);
  const [acknowledged, setAcknowledged] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = key => e => setPatient(p => ({ ...p, [key]: e.target.value }));

  /*
   * Duplicate checking, as they type.
   *
   * Advisory the whole way down: it shows what it found and never blocks the
   * button. The receptionist is the one who knows whether the Adewale in front
   * of her is the Adewale on the screen.
   */
  const timer = useRef(null);
  const checkDuplicates = useCallback(async () => {
    const { surname, firstName, phone, dateOfBirth } = patient;
    if (!surname && !phone && !dateOfBirth) {
      setDuplicates([]);
      return;
    }
    try {
      const { candidates } = await api.post('/api/patients/check-duplicates', {
        surname: surname || null,
        firstName: firstName || null,
        phone: phone || null,
        dateOfBirth: dateOfBirth || null,
        identifiers: identifier.value ? [{ type: identifier.type, value: identifier.value }] : []
      });
      setDuplicates(candidates);
    } catch {
      // A failed duplicate check must never get in the way of registering.
      setDuplicates([]);
    }
  }, [patient, identifier]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(checkDuplicates, 500);
    return () => clearTimeout(timer.current);
  }, [checkDuplicates]);

  const missing = WORTH_HAVING.filter(([key]) => !patient[key]).map(([, label]) => label);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    // Empty strings are stripped rather than sent. "" in a nullable column is a
    // value — it looks filled in when it is not, and every later "is this
    // missing?" check misses it.
    const clean = obj =>
      Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));

    const body = {
      patient: clean(patient),
      kin: kin.name || kin.phone ? [clean(kin)] : [],
      payers: payer.payerType ? [clean(payer)] : [],
      identifiers: identifier.value ? [clean(identifier)] : [],
      visit: openVisit ? clean(visit) : null,
      // Which records she was shown and decided were not this person. If a
      // duplicate surfaces next year, this is the difference between an
      // oversight and a judgement.
      acknowledgedDuplicates: acknowledged
    };

    try {
      const { patient: created } = await api.post('/api/patients', body);
      navigate(`/patients/${created.id}?registered=1`);
    } catch (err) {
      setError(err.message);
      setFieldErrors(
        Object.fromEntries((err.fields ?? []).map(f => [f.field.replace(/^patient\./, ''), f.message]))
      );
      setBusy(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1>Register a patient</h1>
        <p className="page__sub">
          Nothing here is required. Record what you know and leave the rest
          blank — a guess is worse than a gap.
        </p>
      </header>

      {error && <p className="msg msg--bad">{error}</p>}

      {duplicates.length > 0 && (
        <section className="notice">
          <h2>
            {duplicates.length === 1 ? 'A similar record exists' : `${duplicates.length} similar records exist`}
          </h2>
          <p>
            Check whether one of these is the same person. If it is, open it
            instead of registering again. If not, carry on — this does not stop
            you.
          </p>

          <ul className="candidates">
            {duplicates.map(c => (
              <li key={c.id}>
                <div>
                  <Link to={`/patients/${c.id}`} className="candidates__name">{fullName(c)}</Link>
                  <span className="mono">{c.mrn}</span>
                  <span className="candidates__why">
                    {c.reasons.join(', ')} · {shortDate(c.dateOfBirth)} · {c.phone ?? 'no phone'}
                  </span>
                </div>
                <label className="candidates__ack">
                  <input
                    type="checkbox"
                    checked={acknowledged.includes(c.id)}
                    onChange={e =>
                      setAcknowledged(a =>
                        e.target.checked ? [...a, c.id] : a.filter(id => id !== c.id)
                      )
                    }
                  />
                  Not this person
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit}>
        <section className="panel">
          <h2>Identity</h2>
          <div className="row row--3">
            <Field label="Surname" error={fieldErrors.surname}>
              <input value={patient.surname} onChange={set('surname')} />
            </Field>
            <Field label="First name" error={fieldErrors.firstName}>
              <input value={patient.firstName} onChange={set('firstName')} />
            </Field>
            <Field label="Other names" error={fieldErrors.otherNames}>
              <input value={patient.otherNames} onChange={set('otherNames')} />
            </Field>
          </div>
          <div className="row row--3">
            <Field label="Sex" error={fieldErrors.sex}>
              <select value={patient.sex} onChange={set('sex')}>
                <option value="">—</option>
                {SEX.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date of birth" error={fieldErrors.dateOfBirth}>
              <input type="date" value={patient.dateOfBirth} onChange={set('dateOfBirth')} />
            </Field>
            <Field label="Marital status" error={fieldErrors.maritalStatus}>
              <select value={patient.maritalStatus} onChange={set('maritalStatus')}>
                <option value="">—</option>
                {MARITAL.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="panel">
          <h2>Contact</h2>
          <div className="row row--3">
            <Field label="Phone" error={fieldErrors.phone}>
              <input value={patient.phone} onChange={set('phone')} placeholder="08012345678" />
            </Field>
            <Field label="Other phone" error={fieldErrors.altPhone}>
              <input value={patient.altPhone} onChange={set('altPhone')} />
            </Field>
            <Field label="Email" error={fieldErrors.email}>
              <input value={patient.email} onChange={set('email')} />
            </Field>
          </div>
          <Field label="Address" error={fieldErrors.address}>
            <input value={patient.address} onChange={set('address')} />
          </Field>
          <div className="row row--2">
            <Field label="Town or city"><input value={patient.city} onChange={set('city')} /></Field>
            <Field label="State"><input value={patient.state} onChange={set('state')} /></Field>
          </div>
        </section>

        <section className="panel">
          <h2>Background</h2>
          <div className="row row--3">
            <Field label="Occupation"><input value={patient.occupation} onChange={set('occupation')} /></Field>
            <Field label="Nationality"><input value={patient.nationality} onChange={set('nationality')} /></Field>
            <Field label="State of origin"><input value={patient.stateOfOrigin} onChange={set('stateOfOrigin')} /></Field>
          </div>
        </section>

        <section className="panel">
          <h2>Clinical basics</h2>
          <p className="panel__lede">
            Only the few facts every department needs at a glance. Everything
            else clinical belongs to the consultation record.
          </p>
          <div className="row row--3">
            <Field label="Blood group" error={fieldErrors.bloodGroup}>
              <select value={patient.bloodGroup} onChange={set('bloodGroup')}>
                <option value="">—</option>
                {BLOOD.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Genotype" error={fieldErrors.genotype}>
              <select value={patient.genotype} onChange={set('genotype')}>
                <option value="">—</option>
                {GENOTYPE.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Known allergies" hint="Leave blank if not known — not if none">
              <input value={patient.knownAllergies} onChange={set('knownAllergies')} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <h2>Next of kin</h2>
          <div className="row row--3">
            <Field label="Name">
              <input value={kin.name} onChange={e => setKin(k => ({ ...k, name: e.target.value }))} />
            </Field>
            <Field label="Relationship">
              <input value={kin.relationship} onChange={e => setKin(k => ({ ...k, relationship: e.target.value }))} />
            </Field>
            <Field label="Phone">
              <input value={kin.phone} onChange={e => setKin(k => ({ ...k, phone: e.target.value }))} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <h2>Who is paying</h2>
          <p className="panel__lede">
            This decides which price list applies from now on, so it is worth
            getting right at the desk rather than at the cash point.
          </p>
          <div className="row row--3">
            <Field label="Payer">
              <select value={payer.payerType} onChange={e => setPayer(p => ({ ...p, payerType: e.target.value }))}>
                {PAYERS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="HMO or company">
              <input
                value={payer.payerName}
                disabled={payer.payerType === 'self'}
                onChange={e => setPayer(p => ({ ...p, payerName: e.target.value }))}
              />
            </Field>
            <Field label="Policy number">
              <input
                value={payer.policyNumber}
                disabled={payer.payerType === 'self'}
                onChange={e => setPayer(p => ({ ...p, policyNumber: e.target.value }))}
              />
            </Field>
          </div>
        </section>

        <section className="panel">
          <h2>Other numbers</h2>
          <p className="panel__lede">
            A NIN or HMO number is the strongest way to spot a duplicate later —
            names repeat, these do not.
          </p>
          <div className="row row--2">
            <Field label="Type">
              <select value={identifier.type} onChange={e => setIdentifier(i => ({ ...i, type: e.target.value }))}>
                {ID_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Number">
              <input value={identifier.value} onChange={e => setIdentifier(i => ({ ...i, value: e.target.value }))} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <h2>Today's visit</h2>
          <label className="check">
            <input type="checkbox" checked={openVisit} onChange={e => setOpenVisit(e.target.checked)} />
            <span>
              Open a visit now
              <small>
                Uncheck when digitising an old paper folder — there is no
                attendance today.
              </small>
            </span>
          </label>

          {openVisit && (
            <div className="row row--3">
              <Field label="Type">
                <select value={visit.type} onChange={e => setVisit(v => ({ ...v, type: e.target.value }))}>
                  <option value="outpatient">outpatient</option>
                  <option value="follow-up">follow-up</option>
                  <option value="antenatal">antenatal</option>
                  <option value="emergency">emergency</option>
                </select>
              </Field>
              <Field label="Department">
                <input value={visit.department} onChange={e => setVisit(v => ({ ...v, department: e.target.value }))} />
              </Field>
              <Field label="Doctor">
                <input value={visit.doctor} onChange={e => setVisit(v => ({ ...v, doctor: e.target.value }))} />
              </Field>
            </div>
          )}
        </section>

        <div className="formfoot">
          {missing.length > 0 && (
            <p className="formfoot__note">
              Not recorded: {missing.join(', ')}. That is fine — the record will
              appear on the follow-up list.
            </p>
          )}
          <div className="formfoot__actions">
            <Link className="btn" to="/patients">Cancel</Link>
            <button className="btn btn--primary btn--inline" type="submit" disabled={busy}>
              {busy ? 'Registering…' : 'Register patient'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
