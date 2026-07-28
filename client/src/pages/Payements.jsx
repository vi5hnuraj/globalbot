import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiSend, FiDollarSign, FiInbox } from 'react-icons/fi';
import Pay from '../components/Pay';
import Request from './Request';
import RequestForm from '../components/RequestForm';

const tabs = [
  { key: 'pay', label: 'Pay', icon: FiSend },
  { key: 'send-request', label: 'Request', icon: FiDollarSign },
  { key: 'reqpay', label: 'Inbox', icon: FiInbox },
];

const Payements = () => {
    const [searchParams] = useSearchParams();
    const [active, setActive] = useState(searchParams.get("tab") || (searchParams.get("prefillFromRequest") ? "pay" : "pay"));

    useEffect(() => {
        if (searchParams.get("tab")) {
            setActive(searchParams.get("tab"));
        } else if (searchParams.get("prefillFromRequest") === "true") {
            setActive("pay");
        }
    }, [searchParams]);

    return (
        <div className='flex flex-col bg-black w-full text-white border-t border-zinc-800 min-h-screen overflow-y-auto'>
            <div className='w-full max-w-4xl mx-auto px-3 sm:px-8 pt-4 sm:pt-8 pb-0'>
              <div className='flex gap-1 sm:gap-2 bg-zinc-900/60 p-1.5 rounded-2xl border border-zinc-800/60'>
                {tabs.map(({ key, label, icon: Icon }) => (
                  <div
                    key={key}
                    onClick={() => setActive(key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl text-[11px] sm:text-sm font-bold uppercase tracking-widest transition-all cursor-pointer ${
                      active === key
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                  >
                    <Icon size={15} className="sm:w-4 sm:h-4" />
                    {label}
                  </div>
                ))}
              </div>
            </div>
            <div className='flex justify-center px-3 sm:px-4 pt-6 sm:pt-8 pb-8'>
                {active === "pay" && <Pay />}
                {active === "send-request" && <RequestForm />}
                {active === "reqpay" && <Request />}
            </div>
        </div>
    )
}

export default Payements;
