import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Pay from '../components/Pay';
import Request from './Request';
import RequestForm from '../components/RequestForm';

const Payements = () => {
    const [searchParams] = useSearchParams();
    // Default to "pay" if redirecting from request, otherwise use initial state or URL config
    const [active, setActive] = useState(searchParams.get("tab") || (searchParams.get("prefillFromRequest") ? "pay" : "pay"));

    useEffect(() => {
        if (searchParams.get("tab")) {
            setActive(searchParams.get("tab"));
        } else if (searchParams.get("prefillFromRequest") === "true") {
            setActive("pay");
        }
    }, [searchParams]);

    const toggleHandler = (paymentType) => {
        setActive(paymentType);
    }

    const activeClass = "bg-blue-600 text-white border-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.3)]";
    const inactiveClass = "bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-white";

    return (
        <div className='flex flex-col bg-black w-full text-white border-t border-zinc-800 h-screen overflow-y-auto'>
            <div className='w-full max-w-4xl mx-auto flex px-8 py-8 gap-6 text-sm font-bold uppercase tracking-widest'>
                <div 
                    onClick={() => toggleHandler("pay")} 
                    className={`w-full flex justify-center border p-4 rounded-2xl transition-all cursor-pointer ${active === "pay" ? activeClass : inactiveClass}`}
                >
                    Pay
                </div>
                <div 
                    onClick={() => toggleHandler("send-request")} 
                    className={`w-full flex justify-center border p-4 rounded-2xl transition-all cursor-pointer ${active === "send-request" ? activeClass : inactiveClass}`}
                >
                    Request Money
                </div>
                <div 
                    onClick={() => toggleHandler("reqpay")} 
                    className={`w-full flex justify-center border p-4 rounded-2xl transition-all cursor-pointer ${active === "reqpay" ? activeClass : inactiveClass}`}
                >
                    Inbox (Reqpay)
                </div>
            </div>
            <div className='h-full flex justify-center px-4'>
                {active === "pay" && <Pay />}
                {active === "send-request" && <RequestForm />}
                {active === "reqpay" && <Request />}
            </div>
        </div>
    )
}

export default Payements;
